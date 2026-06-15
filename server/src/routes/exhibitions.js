/**
 * 展会路由
 * 处理展会相关操作
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { query } = require('../config/pool');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth');

/**
 * 验证请求数据
 */
const validateExhibition = [
  body('title').notEmpty().withMessage('展会名称不能为空'),
  body('venue').notEmpty().withMessage('展馆地点不能为空'),
  body('day').isInt({ min: 1, max: 31 }).withMessage('日期必须在1-31之间'),
  body('month').isInt({ min: 1, max: 12 }).withMessage('月份必须在1-12之间'),
  body('year').isInt({ min: 2020, max: 2030 }).withMessage('年份必须在2020-2030之间'),
  body('time').notEmpty().withMessage('时间不能为空'),
  body('status').optional().isIn(['报名中', '截止报名', '已结束']).withMessage('无效的状态值'),
  body('openForRegistration').optional().isBoolean().withMessage('报名状态必须是布尔值'),
  body('description').optional().isString().withMessage('描述必须是字符串'),
  body('category').optional().isString().withMessage('分类必须是字符串')
];

/**
 * GET /api/v1/exhibitions
 * 获取展会列表
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { month, year, status, category, search } = req.query;
    
    let sql = 'SELECT * FROM exhibitions WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    // 按月份筛选
    if (month) {
      sql += ` AND month = $${paramIndex++}`;
      params.push(parseInt(month));
    }
    
    // 按年份筛选
    if (year) {
      sql += ` AND year = $${paramIndex++}`;
      params.push(parseInt(year));
    }
    
    // 按状态筛选
    if (status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    
    // 按分类筛选
    if (category) {
      sql += ` AND category ILIKE $${paramIndex++}`;
      params.push(`%${category}%`);
    }
    
    // 搜索
    if (search) {
      sql += ` AND (title ILIKE $${paramIndex} OR venue ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    sql += ' ORDER BY year, month, day';
    
    const result = await query(sql, params);
    
    res.json({
      data: result.rows
    });
    
  } catch (error) {
    console.error('获取展会列表错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '获取展会列表失败'
    });
  }
});

/**
 * GET /api/v1/exhibitions/search
 * 搜索展会
 */
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({
        error: '验证失败',
        message: '搜索关键词不能为空'
      });
    }
    
    const result = await query(
      `SELECT * FROM exhibitions 
       WHERE title ILIKE $1 OR venue ILIKE $1 OR description ILIKE $1 OR category ILIKE $1
       ORDER BY year, month, day`,
      [`%${q}%`]
    );
    
    res.json({
      data: result.rows
    });
    
  } catch (error) {
    console.error('搜索展会错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '搜索展会失败'
    });
  }
});

/**
 * GET /api/v1/exhibitions/:id
 * 获取单个展会信息
 */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      'SELECT * FROM exhibitions WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: '未找到',
        message: '展会不存在'
      });
    }
    
    res.json({
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('获取展会信息错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '获取展会信息失败'
    });
  }
});

/**
 * POST /api/v1/exhibitions
 * 创建展会（仅展商和管理员）
 */
router.post('/', authenticate, authorize(['exhibitor', 'admin']), validateExhibition, async (req, res) => {
  try {
    // 验证请求数据
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: '验证失败',
        message: errors.array()[0].msg
      });
    }
    
    const { title, venue, day, month, year, time, status, openForRegistration, description, category } = req.body;
    
    // 生成展会 ID
    const result = await query(
      "SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) as max_id FROM exhibitions WHERE id LIKE 'exh-%'"
    );
    const nextId = (result.rows[0].max_id || 0) + 1;
    const exhibitionId = `exh-${nextId}`;
    
    // 插入展会
    await query(
      `INSERT INTO exhibitions (id, title, venue, day, month, year, time, status, open_for_registration, description, category, exhibitor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [exhibitionId, title, venue, day, month, year, time, 
       status || '报名中', openForRegistration !== false, description || '', category || '', req.user.userId]
    );
    
    // 查询新创建的展会
    const result2 = await query(
      'SELECT * FROM exhibitions WHERE id = $1',
      [exhibitionId]
    );
    
    res.status(201).json({
      data: result2.rows[0]
    });
    
  } catch (error) {
    console.error('创建展会错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '创建展会失败'
    });
  }
});

/**
 * PUT /api/v1/exhibitions/:id
 * 更新展会
 */
router.put('/:id', authenticate, validateExhibition, async (req, res) => {
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
    const { title, venue, day, month, year, time, status, openForRegistration, description, category } = req.body;
    
    // 检查展会是否存在
    const existingExhibition = await query(
      'SELECT * FROM exhibitions WHERE id = $1',
      [id]
    );
    
    if (existingExhibition.rows.length === 0) {
      return res.status(404).json({
        error: '未找到',
        message: '展会不存在'
      });
    }
    
    // 检查权限：只有展会创建者或管理员可以更新
    if (req.user.role !== 'admin' && existingExhibition.rows[0].exhibitor_id !== req.user.userId) {
      return res.status(403).json({
        error: '访问被拒绝',
        message: '无权修改此展会'
      });
    }
    
    // 更新展会
    await query(
      `UPDATE exhibitions 
       SET title = $1, venue = $2, day = $3, month = $4, year = $5, time = $6, 
           status = $7, open_for_registration = $8, description = $9, category = $10, updated_at = CURRENT_TIMESTAMP
       WHERE id = $11`,
      [title, venue, day, month, year, time, status, openForRegistration, description, category, id]
    );
    
    // 查询更新后的展会
    const result = await query(
      'SELECT * FROM exhibitions WHERE id = $1',
      [id]
    );
    
    res.json({
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('更新展会错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '更新展会失败'
    });
  }
});

/**
 * DELETE /api/v1/exhibitions/:id
 * 删除展会
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 检查展会是否存在
    const existingExhibition = await query(
      'SELECT * FROM exhibitions WHERE id = $1',
      [id]
    );
    
    if (existingExhibition.rows.length === 0) {
      return res.status(404).json({
        error: '未找到',
        message: '展会不存在'
      });
    }
    
    // 检查权限：只有展会创建者或管理员可以删除
    if (req.user.role !== 'admin' && existingExhibition.rows[0].exhibitor_id !== req.user.userId) {
      return res.status(403).json({
        error: '访问被拒绝',
        message: '无权删除此展会'
      });
    }
    
    // 删除展会
    await query(
      'DELETE FROM exhibitions WHERE id = $1',
      [id]
    );
    
    res.json({
      data: {
        message: '展会删除成功'
      }
    });
    
  } catch (error) {
    console.error('删除展会错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '删除展会失败'
    });
  }
});

/**
 * PUT /api/v1/exhibitions/:id/status
 * 更新展会状态
 */
router.put('/:id/status', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // 验证状态值
    const validStatuses = ['报名中', '截止报名', '已结束'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: '验证失败',
        message: '无效的状态值'
      });
    }
    
    // 检查展会是否存在
    const existingExhibition = await query(
      'SELECT * FROM exhibitions WHERE id = $1',
      [id]
    );
    
    if (existingExhibition.rows.length === 0) {
      return res.status(404).json({
        error: '未找到',
        message: '展会不存在'
      });
    }
    
    // 检查权限：只有展会创建者或管理员可以更新状态
    if (req.user.role !== 'admin' && existingExhibition.rows[0].exhibitor_id !== req.user.userId) {
      return res.status(403).json({
        error: '访问被拒绝',
        message: '无权更新此展会状态'
      });
    }
    
    // 更新状态
    const openForRegistration = status === '报名中';
    await query(
      'UPDATE exhibitions SET status = $1, open_for_registration = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [status, openForRegistration, id]
    );
    
    // 查询更新后的展会
    const result = await query(
      'SELECT * FROM exhibitions WHERE id = $1',
      [id]
    );
    
    res.json({
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('更新展会状态错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '更新展会状态失败'
    });
  }
});

module.exports = router;
