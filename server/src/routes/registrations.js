/**
 * 报名路由
 * 处理展会报名相关操作
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/pool');
const { authenticate, authorize } = require('../middleware/auth');

/**
 * 验证请求数据
 */
const validateRegistration = [
  body('exhibitionId').notEmpty().withMessage('展会ID不能为空'),
  body('visitorName').notEmpty().withMessage('访客姓名不能为空'),
  body('visitorType').notEmpty().withMessage('访客类型不能为空'),
  body('needsSummary').optional().isString().withMessage('需求摘要必须是字符串')
];

/**
 * GET /api/v1/registrations
 * 获取报名列表
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { exhibitionId, status } = req.query;
    
    let sql = 'SELECT * FROM registrations WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    // 普通用户只能查看自己的报名
    if (req.user.role === 'user') {
      sql += ` AND visitor_id = $${paramIndex++}`;
      params.push(req.user.userId);
    }
    
    // 按展会筛选
    if (exhibitionId) {
      sql += ` AND exhibition_id = $${paramIndex++}`;
      params.push(exhibitionId);
    }
    
    // 按状态筛选
    if (status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const result = await query(sql, params);
    
    res.json({
      data: result.rows
    });
    
  } catch (error) {
    console.error('获取报名列表错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '获取报名列表失败'
    });
  }
});

/**
 * GET /api/v1/registrations/:id
 * 获取单个报名信息
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      'SELECT * FROM registrations WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: '未找到',
        message: '报名记录不存在'
      });
    }
    
    const registration = result.rows[0];
    
    // 普通用户只能查看自己的报名
    if (req.user.role === 'user' && registration.visitor_id !== req.user.userId) {
      return res.status(403).json({
        error: '访问被拒绝',
        message: '无权查看此报名记录'
      });
    }
    
    res.json({
      data: registration
    });
    
  } catch (error) {
    console.error('获取报名信息错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '获取报名信息失败'
    });
  }
});

/**
 * POST /api/v1/registrations
 * 创建报名
 */
router.post('/', authenticate, validateRegistration, async (req, res) => {
  try {
    // 验证请求数据
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: '验证失败',
        message: errors.array()[0].msg
      });
    }
    
    const { exhibitionId, visitorName, visitorType, needsSummary } = req.body;
    
    // 检查展会是否存在
    const exhibitionResult = await query(
      'SELECT * FROM exhibitions WHERE id = $1',
      [exhibitionId]
    );
    
    if (exhibitionResult.rows.length === 0) {
      return res.status(404).json({
        error: '未找到',
        message: '展会不存在'
      });
    }
    
    const exhibition = exhibitionResult.rows[0];
    
    // 检查展会是否开放报名
    if (!exhibition.open_for_registration) {
      return res.status(400).json({
        error: '验证失败',
        message: '该展会已截止报名'
      });
    }
    
    // 检查是否已报名
    const existingRegistration = await query(
      'SELECT id FROM registrations WHERE exhibition_id = $1 AND visitor_id = $2',
      [exhibitionId, req.user.userId]
    );
    
    if (existingRegistration.rows.length > 0) {
      return res.status(409).json({
        error: '冲突',
        message: '您已报名此展会'
      });
    }
    
    // 生成报名 ID
    const registrationId = `reg-${uuidv4()}`;
    
    // 创建报名
    await query(
      `INSERT INTO registrations (id, exhibition_id, exhibition_title, exhibition_day, exhibition_time, exhibition_venue, visitor_name, visitor_type, needs_summary, status, visitor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)`,
      [registrationId, exhibitionId, exhibition.title, exhibition.day, exhibition.time, exhibition.venue,
       visitorName, visitorType, needsSummary || '', req.user.userId]
    );
    
    // 查询新创建的报名
    const result = await query(
      'SELECT * FROM registrations WHERE id = $1',
      [registrationId]
    );
    
    res.status(201).json({
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('创建报名错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '创建报名失败'
    });
  }
});

/**
 * PUT /api/v1/registrations/:id
 * 更新报名状态
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // 验证状态值
    const validStatuses = ['pending', 'approved', 'rejected', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: '验证失败',
        message: '无效的状态值'
      });
    }
    
    // 检查报名是否存在
    const existingRegistration = await query(
      'SELECT * FROM registrations WHERE id = $1',
      [id]
    );
    
    if (existingRegistration.rows.length === 0) {
      return res.status(404).json({
        error: '未找到',
        message: '报名记录不存在'
      });
    }
    
    const registration = existingRegistration.rows[0];
    
    // 检查权限
    if (req.user.role === 'user') {
      // 普通用户只能取消自己的报名
      if (registration.visitor_id !== req.user.userId) {
        return res.status(403).json({
          error: '访问被拒绝',
          message: '无权修改此报名记录'
        });
      }
      if (status !== 'cancelled') {
        return res.status(403).json({
          error: '访问被拒绝',
          message: '普通用户只能取消报名'
        });
      }
    } else if (req.user.role === 'exhibitor') {
      // 展商只能管理自己展会的报名
      const exhibitionResult = await query(
        'SELECT exhibitor_id FROM exhibitions WHERE id = $1',
        [registration.exhibition_id]
      );
      
      if (exhibitionResult.rows.length === 0 || exhibitionResult.rows[0].exhibitor_id !== req.user.userId) {
        return res.status(403).json({
          error: '访问被拒绝',
          message: '无权管理此展会的报名'
        });
      }
    }
    
    // 更新报名状态
    await query(
      'UPDATE registrations SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, id]
    );
    
    // 查询更新后的报名
    const result = await query(
      'SELECT * FROM registrations WHERE id = $1',
      [id]
    );
    
    res.json({
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('更新报名状态错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '更新报名状态失败'
    });
  }
});

/**
 * DELETE /api/v1/registrations/:id
 * 删除报名
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 检查报名是否存在
    const existingRegistration = await query(
      'SELECT * FROM registrations WHERE id = $1',
      [id]
    );
    
    if (existingRegistration.rows.length === 0) {
      return res.status(404).json({
        error: '未找到',
        message: '报名记录不存在'
      });
    }
    
    const registration = existingRegistration.rows[0];
    
    // 检查权限：只有报名者本人或管理员可以删除
    if (req.user.role !== 'admin' && registration.visitor_id !== req.user.userId) {
      return res.status(403).json({
        error: '访问被拒绝',
        message: '无权删除此报名记录'
      });
    }
    
    // 删除报名
    await query(
      'DELETE FROM registrations WHERE id = $1',
      [id]
    );
    
    res.json({
      data: {
        message: '报名记录删除成功'
      }
    });
    
  } catch (error) {
    console.error('删除报名错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '删除报名失败'
    });
  }
});

module.exports = router;
