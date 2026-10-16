/**
 * 契约测试的全局准备：建一个已迁移、已 seed 的模板库。
 *
 * 每个测试文件从模板克隆出自己的库（库名见 `src/test/contract-template.ts`），
 * 所以文件之间互不干扰、可以并行跑，迁移与示例数据只跑一次。
 *
 * 这里在**导入任何 src 模块之前**把 `DB_NAME` 指向模板库：`config/database.ts`
 * 与连接池都在加载时读环境变量，晚设就会连到别的库上。
 */
import { Client } from 'pg';
import { contractBaseName, contractTemplateName } from '../src/test/contract-template.js';

const template = contractTemplateName();

async function connectAdmin(): Promise<Client> {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: 'postgres',
  });
  await client.connect();
  return client;
}

/** 建模板库 → 迁移 → seed → 断开与模板库的连接（别人克隆时不能还有会话连着它）。 */
export async function setup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'quiet';
  process.env.MAIL_TRANSPORT = 'memory';
  process.env.DB_NAME = template;

  const admin = await connectAdmin();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${template}"`);
  } finally {
    await admin.end();
  }

  const [{ migrate, seed }, { close }] = await Promise.all([
    import('../src/config/migrate.js'),
    import('../src/config/pool.js'),
  ]);
  await migrate();
  await seed();
  await close();
}

/** 收尾：模板库与各文件的库都删掉，测试库不留在本机。 */
export async function teardown(): Promise<void> {
  const admin = await connectAdmin();
  try {
    const result = await admin.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname = $1 OR datname LIKE $2',
      [template, `${contractBaseName()}\\_%`],
    );
    for (const row of result.rows) {
      await admin.query(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}
