/**
 * 认证中间件
 * 处理 JWT 令牌验证和权限检查
 */

const jwt = require('jsonwebtoken');
const { query } = require('../config/pool');

// JWT 配置
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_here';

/**
 * 认证中间件
 * 验证 JWT 令牌并附加用户信息到请求对象
 */
async function authenticate(req, res, next) {
  try {
    // 从请求头获取令牌
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: '认证失败',
        message: '未提供认证令牌'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // 验证令牌
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: '认证失败',
          message: '令牌已过期，请刷新令牌'
        });
      }
      return res.status(401).json({
        error: '认证失败',
        message: '无效的认证令牌'
      });
    }
    
    // 查询用户信息
    const result = await query(
      'SELECT id, username, email, nickname, role, status FROM users WHERE id = $1',
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
    
    // 附加用户信息到请求对象
    req.user = {
      userId: user.id,
      username: user.username,
      email: user.email,
      nickname: user.nickname,
      role: user.role
    };
    
    next();
    
  } catch (error) {
    console.error('认证中间件错误：', error);
    res.status(500).json({
      error: '服务器错误',
      message: '认证失败'
    });
  }
}

/**
 * 授权中间件
 * 检查用户角色权限
 * @param {Array} roles - 允许的角色列表
 */
function authorize(roles) {
  return (req, res, next) => {
    // 检查用户是否已认证
    if (!req.user) {
      return res.status(401).json({
        error: '认证失败',
        message: '未认证的用户'
      });
    }
    
    // 检查用户角色
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: '访问被拒绝',
        message: '无权执行此操作'
      });
    }
    
    next();
  };
}

/**
 * 可选认证中间件
 * 如果提供了令牌则验证，否则继续
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      const result = await query(
        'SELECT id, username, email, nickname, role, status FROM users WHERE id = $1',
        [decoded.userId]
      );
      
      if (result.rows.length > 0 && result.rows[0].status === 'active') {
        req.user = {
          userId: result.rows[0].id,
          username: result.rows[0].username,
          email: result.rows[0].email,
          nickname: result.rows[0].nickname,
          role: result.rows[0].role
        };
      }
    } catch (error) {
      // 令牌无效，继续而不附加用户信息
    }
    
    next();
    
  } catch (error) {
    console.error('可选认证中间件错误：', error);
    next();
  }
}

module.exports = {
  authenticate,
  authorize,
  optionalAuth
};
