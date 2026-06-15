/**
 * 认证路由
 * 处理用户登录、注册、刷新令牌等
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/pool');

// JWT 配置
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_here';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your_jwt_refresh_secret_here';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * 生成访问令牌和刷新令牌
 * @param {Object} user - 用户对象
 * @returns {Object} 包含 accessToken 和 refreshToken
 */
function generateTokens(user) {
  const accessToken = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  
  const refreshToken = jwt.sign(
    { userId: user.id },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );
  
  return { accessToken, refreshToken };
}

/**
 * 验证请求数据
 */
const validateLogin = [
  body('username').notEmpty().withMessage('用户名不能为空'),
  body('password').notEmpty().withMessage('密码不能为空')
];

const validateRegister = [
  body('username').notEmpty().withMessage('用户名不能为空'),
  body('password').isLength({ min: 6 }).withMessage('密码至少6个字符'),
  body('email').isEmail().withMessage('邮箱格式不正确'),
  body('nickname').notEmpty().withMessage('昵称不能为空')
];

/**
 * POST /api/v1/auth/login
 * 用户登录
 */
router.post('/login', validateLogin, async (req, res) => {
  try {
    // 验证请求数据
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: '验证失败',
        message: errors.array()[0].msg
      });
    }
    
    const { username, password } = req.body;
    
    // 查找用户
    const result = await query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({
        error: '认证失败',
        message: '用户名或密码错误'
      });
    }
    
    const user = result.rows[0];
    
    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        error: '认证失败',
        message: '用户名或密码错误'
      });
    }
    
    // 检查用户状态
    if (user.status !== 'active') {
      return res.status(403).json({
        error: '访问被拒绝',
        message: '账号已被禁用'
      });
    }
    
    // 更新最后登录时间
    await query(
      'UPDATE users SET last_login_time = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );
    
    // 生成令牌
    const tokens = generateTokens(user);
    
    // 返回用户信息和令牌
    res.json({
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          nickname: user.nickname,
          role: user.role,
          status: user.status
        },
        ...tokens
      }
    });
    
  } catch (error) {
    console.error('登录错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '登录失败，请稍后重试'
    });
  }
});

/**
 * POST /api/v1/auth/register
 * 用户注册
 */
router.post('/register', validateRegister, async (req, res) => {
  try {
    // 验证请求数据
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: '验证失败',
        message: errors.array()[0].msg
      });
    }
    
    const { username, password, email, nickname } = req.body;
    
    // 检查用户名是否已存在
    const existingUser = await query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: '冲突',
        message: '用户名或邮箱已存在'
      });
    }
    
    // 加密密码
    const passwordHash = await bcrypt.hash(password, 10);
    
    // 生成用户 ID
    const userId = `usr-${uuidv4()}`;
    
    // 插入用户
    await query(
      `INSERT INTO users (id, username, password_hash, email, nickname, role, status)
       VALUES ($1, $2, $3, $4, $5, 'user', 'active')`,
      [userId, username, passwordHash, email, nickname]
    );
    
    // 查询新创建的用户
    const result = await query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    
    const user = result.rows[0];
    
    // 生成令牌
    const tokens = generateTokens(user);
    
    // 返回用户信息和令牌
    res.status(201).json({
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          nickname: user.nickname,
          role: user.role,
          status: user.status
        },
        ...tokens
      }
    });
    
  } catch (error) {
    console.error('注册错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '注册失败，请稍后重试'
    });
  }
});

/**
 * POST /api/v1/auth/refresh
 * 刷新令牌
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({
        error: '验证失败',
        message: '刷新令牌不能为空'
      });
    }
    
    // 验证刷新令牌
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (error) {
      return res.status(401).json({
        error: '认证失败',
        message: '刷新令牌无效或已过期'
      });
    }
    
    // 查询用户
    const result = await query(
      'SELECT * FROM users WHERE id = $1',
      [decoded.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({
        error: '认证失败',
        message: '用户不存在'
      });
    }
    
    const user = result.rows[0];
    
    // 检查用户状态
    if (user.status !== 'active') {
      return res.status(403).json({
        error: '访问被拒绝',
        message: '账号已被禁用'
      });
    }
    
    // 生成新令牌
    const tokens = generateTokens(user);
    
    // 返回新令牌
    res.json({
      data: tokens
    });
    
  } catch (error) {
    console.error('刷新令牌错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '刷新令牌失败，请稍后重试'
    });
  }
});

/**
 * POST /api/v1/auth/logout
 * 用户登出
 */
router.post('/logout', async (req, res) => {
  try {
    // 在实际应用中，这里应该将令牌加入黑名单
    // 目前简单返回成功
    res.json({
      data: {
        message: '登出成功'
      }
    });
  } catch (error) {
    console.error('登出错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '登出失败，请稍后重试'
    });
  }
});

module.exports = router;
