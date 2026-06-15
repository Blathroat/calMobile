/**
 * 数据库迁移脚本
 * 创建数据库表结构
 */

const { pool } = require('./pool');

/**
 * 执行数据库迁移
 * 创建所有必要的表
 */
async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('开始数据库迁移...');
    
    // 开始事务
    await client.query('BEGIN');
    
    // 创建用户表
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        nickname VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        bio TEXT,
        contact VARCHAR(255),
        social_media VARCHAR(255),
        registration_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login_time TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('用户表创建成功');
    
    // 创建展会表
    await client.query(`
      CREATE TABLE IF NOT EXISTS exhibitions (
        id VARCHAR(50) PRIMARY KEY,
        day INTEGER NOT NULL,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        venue VARCHAR(255) NOT NULL,
        time VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT '报名中',
        open_for_registration BOOLEAN DEFAULT true,
        description TEXT,
        category VARCHAR(100),
        exhibitor_id VARCHAR(50) REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('展会表创建成功');
    
    // 创建报名表
    await client.query(`
      CREATE TABLE IF NOT EXISTS registrations (
        id VARCHAR(50) PRIMARY KEY,
        exhibition_id VARCHAR(50) REFERENCES exhibitions(id),
        exhibition_title VARCHAR(255) NOT NULL,
        exhibition_day INTEGER NOT NULL,
        exhibition_time VARCHAR(100) NOT NULL,
        exhibition_venue VARCHAR(255) NOT NULL,
        visitor_name VARCHAR(100) NOT NULL,
        visitor_type VARCHAR(50) NOT NULL,
        needs_summary TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        visitor_id VARCHAR(50) REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('报名表创建成功');
    
    // 创建通知表
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(50) NOT NULL,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('通知表创建成功');
    
    // 创建日历事件表
    await client.query(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) REFERENCES users(id),
        exhibition_id VARCHAR(50) REFERENCES exhibitions(id),
        event_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('日历事件表创建成功');
    
    // 提交事务
    await client.query('COMMIT');
    console.log('数据库迁移完成');
    
  } catch (error) {
    // 回滚事务
    await client.query('ROLLBACK');
    console.error('数据库迁移失败：', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 插入示例数据
 */
async function seed() {
  const client = await pool.connect();
  
  try {
    console.log('开始插入示例数据...');
    
    // 开始事务
    await client.query('BEGIN');
    
    // 插入示例用户
    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash('password', 10);
    
    await client.query(`
      INSERT INTO users (id, username, password_hash, email, nickname, role, status)
      VALUES 
        ('usr-1', 'demo', $1, 'demo@example.com', '展会达人', 'admin', 'active'),
        ('usr-2', 'exhibitor', $1, 'exhibitor@example.com', '展商用户', 'exhibitor', 'active'),
        ('usr-3', 'user', $1, 'user@example.com', '普通用户', 'user', 'active')
      ON CONFLICT (id) DO NOTHING
    `, [passwordHash]);
    console.log('示例用户插入成功');
    
    // 插入示例展会
    await client.query(`
      INSERT INTO exhibitions (id, day, month, year, title, venue, time, status, open_for_registration, description, category, exhibitor_id)
      VALUES 
        ('exh-1', 6, 6, 2026, '华南智能制造展', '深圳国际会展中心 6 号馆', '09:30-17:00', '报名中', true, '聚焦工业机器人、柔性产线和数字化工厂方案，适合制造业采购与技术负责人参观。', '智能制造 / 工业自动化', 'usr-2'),
        ('exh-2', 12, 6, 2026, '绿色能源装备展', '广州琶洲展馆 A 区', '10:00-18:00', '报名中', true, '展示储能、电池回收、光伏逆变器和低碳园区方案，现场开放采购对接区。', '新能源 / 储能', 'usr-2'),
        ('exh-3', 12, 6, 2026, '跨境电商选品会', '广州琶洲展馆 B 区', '13:30-20:00', '席位紧张', true, '本地假数据演示：用当天多场展会验证列表、详情和报名表单切换流程。', '电商 / 选品', 'usr-2'),
        ('exh-4', 21, 6, 2026, '城市更新材料展', '上海新国际博览中心', '09:00-16:30', '报名截止', false, '面向建筑材料、节能门窗和旧改服务商的专业展，当前样例设置为不可报名状态。', '建筑材料 / 城市更新', 'usr-2')
      ON CONFLICT (id) DO NOTHING
    `);
    console.log('示例展会插入成功');
    
    // 插入示例报名
    await client.query(`
      INSERT INTO registrations (id, exhibition_id, exhibition_title, exhibition_day, exhibition_time, exhibition_venue, visitor_name, visitor_type, needs_summary, status, visitor_id)
      VALUES 
        ('reg-1', 'exh-1', '华南智能制造展', 6, '09:30-17:00', '深圳国际会展中心 6 号馆', '张三', '专业观众', '需要停车位', 'pending', 'usr-3'),
        ('reg-2', 'exh-2', '绿色能源装备展', 12, '10:00-18:00', '广州琶洲展馆 A 区', '李四', '采购商', '需要翻译服务', 'pending', 'usr-3')
      ON CONFLICT (id) DO NOTHING
    `);
    console.log('示例报名插入成功');
    
    // 提交事务
    await client.query('COMMIT');
    console.log('示例数据插入完成');
    
  } catch (error) {
    // 回滚事务
    await client.query('ROLLBACK');
    console.error('示例数据插入失败：', error);
    throw error;
  } finally {
    client.release();
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'migrate') {
    migrate()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else if (command === 'seed') {
    seed()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else {
    console.log('用法：node database.js [migrate|seed]');
    process.exit(1);
  }
}

module.exports = {
  migrate,
  seed
};
