/**
 * search：展会 + 用户的关键词搜索（访客可读）。
 *
 * 返回 `{ query, exhibitions, users, count }`，`count` 是两块结果之和。
 * 展会按标题 / 地点 / 分类 / 简介匹配；用户按昵称 / 邮箱匹配，
 * 并且**只对管理员**放开非正常状态的账号：访客与普通用户只看到 `status = active` 的用户。
 * 关键词为空时直接返回空结果，而不是把整库数据当成「搜索结果」下发。
 */

const express = require('express');
const { query } = require('../config/pool');
const {
  EXHIBITION_COLUMNS, EXHIBITION_FROM, USER_COLUMNS, USER_FROM,
} = require('../domain/queries');
const { exhibitionPayload } = require('../domain/payloads');
const labels = require('../domain/labels');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

/** 单类结果的条数上限：搜索页是速览，不做分页。 */
const RESULT_LIMIT = 50;

/** ILIKE 的转义：把 % _ \ 变成字面量，避免用户输入被当成通配符。 */
function likePattern(keyword) {
  return `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * 搜索结果里的用户：与演示后端 `search.query` 的字段一致，
 * 不带用户名、密码哈希等内部信息（`USER_COLUMNS` 本身也不含密码）。
 */
function searchUserPayload(row) {
  return {
    id: row.id,
    nickname: row.nickname,
    role: labels.ROLE_LABEL[row.role] || row.role,
    email: row.email || '',
    status: labels.USER_STATUS[row.status] || labels.USER_STATUS.active,
    registrationTime: row.registration_time || '',
    lastLoginTime: row.last_login_time || '',
  };
}

/** GET /api/v1/search?query= */
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const keyword = String(req.query.query === undefined ? '' : req.query.query).trim();
    if (!keyword) {
      res.json({ query: '', exhibitions: [], users: [], count: 0 });
      return;
    }
    const pattern = likePattern(keyword);

    const exhibitions = (await query(`
            SELECT ${EXHIBITION_COLUMNS} ${EXHIBITION_FROM}
            WHERE e.title ILIKE $1 ESCAPE '\\'
               OR e.venue ILIKE $1 ESCAPE '\\'
               OR e.category ILIKE $1 ESCAPE '\\'
               OR e.description ILIKE $1 ESCAPE '\\'
            ORDER BY e.exhibition_date
            LIMIT ${RESULT_LIMIT}
        `, [pattern])).rows.map(exhibitionPayload);

    // 管理员能看到受限 / 封禁账号（用于排查），其余访问者只看正常账号。
    const isAdmin = req.user?.role === 'admin';
    const users = (await query(`
            SELECT ${USER_COLUMNS} ${USER_FROM}
            WHERE (u.nickname ILIKE $1 ESCAPE '\\' OR u.email ILIKE $1 ESCAPE '\\')
              AND ($2::boolean OR u.status = 'active')
            ORDER BY u.nickname
            LIMIT ${RESULT_LIMIT}
        `, [pattern, isAdmin])).rows.map(searchUserPayload);

    res.json({
      query: keyword,
      exhibitions,
      users,
      count: exhibitions.length + users.length,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
