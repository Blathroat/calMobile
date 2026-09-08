/**
 * 用户路由
 * 处理用户相关操作
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { query } = require('../config/pool');
const { authenticate, authorize } = require('../middleware/auth');

/**
 * 验证请求数据
 */
const validateUserUpdate = [
  body('nickname').optional().notEmpty().withMessage('昵称不能为空'),
  body('email').optional().isEmail().withMessage('邮箱格式不正确'),
  body('bio').optional().isString().withMessage('简介必须是字符串'),
  body('contact').optional().isString().withMessage('联系方式必须是字符串'),
  body('socialMedia').optional().isString().withMessage('社交账号必须是字符串')
];

/**
 * GET /api/v1/users
 * 获取用户列表（仅管理员）
 */
router.get('/', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, email, nickname, role, status, 
              registration_time, last_login_time
       FROM users
       ORDER BY registration_time DESC`
    );
    
    res.json({
      data: result.rows
    });
    
  } catch (error) {
    console.error('获取用户列表错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '获取用户列表失败'
    });
  }
});

/**
 * GET /api/v1/users/:id
 * 获取单个用户信息
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 普通用户只能查看自己的信息
    if (req.user.role !== 'admin' && req.user.userId !== id) {
      return res.status(403).json({
        error: '访问被拒绝',
        message: '无权查看其他用户信息'
      });
    }
    
    const result = await query(
      `SELECT id, username, email, nickname, role, status, 
              bio, contact, social_media, registration_time, last_login_time
       FROM users
       WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: '未找到',
        message: '用户不存在'
      });
    }
    
    res.json({
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('获取用户信息错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '获取用户信息失败'
    });
  }
});

/**
 * PUT /api/v1/users/:id
 * 更新用户信息
 */
router.put('/:id', authenticate, validateUserUpdate, async (req, res) => {
  try {
    // 验证请求数据
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: '验证失败',
        message: errors.array()[0].msg
      });
    }
    
    const { id } = req.params;
    const { nickname, email, bio, contact, socialMedia } = req.body;
    
    // 普通用户只能更新自己的信息
    if (req.user.role !== 'admin' && req.user.userId !== id) {
      return res.status(403).json({
        error: '访问被拒绝',
        message: '无权修改其他用户信息'
      });
    }
    
    // 检查用户是否存在
    const existingUser = await query(
      'SELECT id FROM users WHERE id = $1',
      [id]
    );
    
    if (existingUser.rows.length === 0) {
      return res.status(404).json({
        error: '未找到',
        message: '用户不存在'
      });
    }
    
    // 如果更新邮箱，检查是否已存在
    if (email) {
      const existingEmail = await query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, id]
      );
      
      if (existingEmail.rows.length > 0) {
        return res.status(409).json({
          error: '冲突',
          message: '邮箱已被其他用户使用'
        });
      }
    }
    
    // 构建更新语句
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (nickname) {
      updates.push(`nickname = $${paramIndex++}`);
      values.push(nickname);
    }
    if (email) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email);
    }
    if (bio !== undefined) {
      updates.push(`bio = $${paramIndex++}`);
      values.push(bio);
    }
    if (contact !== undefined) {
      updates.push(`contact = $${paramIndex++}`);
      values.push(contact);
    }
    if (socialMedia !== undefined) {
      updates.push(`social_media = $${paramIndex++}`);
      values.push(socialMedia);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({
        error: '验证失败',
        message: '没有要更新的数据'
      });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    
    // 执行更新
    await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
    
    // 查询更新后的用户
    const result = await query(
      `SELECT id, username, email, nickname, role, status, 
              bio, contact, social_media, registration_time, last_login_time
       FROM users
       WHERE id = $1`,
      [id]
    );
    
    res.json({
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('更新用户信息错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '更新用户信息失败'
    });
  }
});

/**
 * DELETE /api/v1/users/:id
 * 删除用户（仅管理员）
 */
router.delete('/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // 检查用户是否存在
    const existingUser = await query(
      'SELECT id FROM users WHERE id = $1',
      [id]
    );
    
    if (existingUser.rows.length === 0) {
      return res.status(404).json({
        error: '未找到',
        message: '用户不存在'
      });
    }
    
    // 删除用户
    await query(
      'DELETE FROM users WHERE id = $1',
      [id]
    );
    
    res.json({
      data: {
        message: '用户删除成功'
      }
    });
    
  } catch (error) {
    console.error('删除用户错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '删除用户失败'
    });
  }
});

/**
 * PUT /api/v1/users/:id/status
 * 更新用户状态（仅管理员）
 */
router.put('/:id/status', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // 验证状态值
    const validStatuses = ['active', 'banned', 'restricted'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: '验证失败',
        message: '无效的状态值'
      });
    }
    
    // 检查用户是否存在
    const existingUser = await query(
      'SELECT id FROM users WHERE id = $1',
      [id]
    );
    
    if (existingUser.rows.length === 0) {
      return res.status(404).json({
        error: '未找到',
        message: '用户不存在'
      });
    }
    
    // 更新状态
    await query(
      'UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, id]
    );
    
    // 查询更新后的用户
    const result = await query(
      `SELECT id, username, email, nickname, role, status, 
              registration_time, last_login_time
       FROM users
       WHERE id = $1`,
      [id]
    );
    
    res.json({
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('更新用户状态错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '更新用户状态失败'
    });
  }
});

module.exports = router;
