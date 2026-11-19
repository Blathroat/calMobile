/**
 * 把 deploy/systemd/*.in 渲染成实例的 systemd 单元文件。
 *
 * 单元里的 `@CALMOBILE_*@` 占位符和更新器读同一套实例配置：默认值 < env 文件
 * （CALMOBILE_*）< 进程环境；`--env-file` 指定另一份 env 文件，`--out` 指定输出目录。
 *
 * 用法（从运行时包或仓库根执行）：
 *   node scripts/render-units.mjs --env-file /etc/calmobile.env --out /etc/systemd/system
 *
 * 输出文件名按 CALMOBILE_SERVICE / CALMOBILE_UPDATE_SERVICE：两个 .service 与从更新
 * 服务名派生的 .timer。写完记得 `systemctl daemon-reload`。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_CONFIG, resolveConfig } from '../deploy/calmobile-update.mjs';

/** 模板目录：仓库 / 运行时包里的 deploy/systemd。 */
const TEMPLATE_DIR = fileURLToPath(new URL('../deploy/systemd/', import.meta.url));

const TEMPLATE_FILES = {
  service: 'calmobile.service.in',
  updateService: 'calmobile-update.service.in',
  timer: 'calmobile-update.timer.in',
};

/** 模板占位符 ← 配置键。 */
const PLACEHOLDERS = {
  CALMOBILE_USER: 'user',
  CALMOBILE_GROUP: 'group',
  CALMOBILE_ROOT: 'root',
  CALMOBILE_ENV_FILE: 'envFile',
  CALMOBILE_SERVICE: 'service',
  CALMOBILE_UPDATE_SERVICE: 'updateService',
  CALMOBILE_UPDATER_PATH: 'updaterPath',
  CALMOBILE_NODE: 'node',
  CALMOBILE_REPOSITORY_URL: 'repositoryUrl',
};

/**
 * 从更新服务名派生 timer 文件名。
 * @param {string} updateService
 * @returns {string}
 */
export function timerUnitName(updateService) {
  const name = String(updateService);
  return name.endsWith('.service') ? `${name.slice(0, -'.service'.length)}.timer` : `${name}.timer`;
}

/**
 * @param {string} text
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
function fillTemplate(text, config) {
  let output = String(text);
  for (const [placeholder, key] of Object.entries(PLACEHOLDERS)) {
    const value = String(config[key] ?? '');
    if (!value) throw new Error(`渲染单元缺少配置：${key}`);
    output = output.split(`@${placeholder}@`).join(value);
  }
  const unknown = /@CALMOBILE_[A-Z0-9_]+@/.exec(output);
  if (unknown) throw new Error(`单元模板含有未知占位符：${unknown[0]}`);
  return output;
}

/**
 * 纯函数：把模板渲染成三个单元文件。
 *
 * config 除占位符对应的配置键外，还要带 `templates`（三个模板文本）；模板由
 * `loadUnitTemplates` 从磁盘读取后传入，所以这个函数本身不碰文件系统。
 *
 * @param {{ templates?: Record<string, string> } & Record<string, unknown>} config
 * @returns {Array<{ name: string, content: string }>}
 */
export function renderUnits(config) {
  const templates = config.templates ?? {};
  for (const [key, file] of Object.entries(TEMPLATE_FILES)) {
    if (!String(templates[key] ?? '').trim()) throw new Error(`缺少单元模板：${file}`);
  }
  return [
    { name: String(config.service), content: fillTemplate(templates.service, config) },
    { name: String(config.updateService), content: fillTemplate(templates.updateService, config) },
    { name: timerUnitName(String(config.updateService)), content: fillTemplate(templates.timer, config) },
  ];
}

/**
 * 读 deploy/systemd 下的三个模板。
 * @param {string} [directory]
 * @returns {Record<string, string>}
 */
export function loadUnitTemplates(directory = TEMPLATE_DIR) {
  /** @type {Record<string, string>} */
  const templates = {};
  for (const [key, file] of Object.entries(TEMPLATE_FILES)) {
    templates[key] = readFileSync(path.join(directory, file), 'utf8');
  }
  return templates;
}

/**
 * @param {string[]} argv
 * @returns {{ envFile: string, outDir: string }}
 */
function parseArgs(argv) {
  /** @type {{ envFile: string, outDir: string }} */
  const options = { envFile: '', outDir: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const readValue = () => {
      if (eq > 0) return arg.slice(eq + 1);
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`参数 ${flag} 缺少值`);
      index += 1;
      return next;
    };
    if (flag === '--env-file') {
      options.envFile = readValue();
    } else if (flag === '--out') {
      options.outDir = readValue();
    } else {
      throw new Error(`不认识的参数：${arg}`);
    }
  }
  if (!options.outDir) {
    throw new Error('用法：node scripts/render-units.mjs --env-file <env 文件> --out <输出目录>');
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  // 命令行给的相对路径按当前目录解析：配置里的 envFile 必须是绝对路径，单元里也要能直接用。
  const envFile = path.resolve(
    String(options.envFile || process.env.CALMOBILE_ENV_FILE || DEFAULT_CONFIG.envFile).trim(),
  );
  let fileText = '';
  try {
    fileText = readFileSync(envFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`读取 ${envFile} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const config = resolveConfig({ fileText, env: process.env, cli: { envFile } });
  const units = renderUnits({ ...config, templates: loadUnitTemplates() });
  mkdirSync(options.outDir, { recursive: true });
  for (const unit of units) {
    const target = path.join(options.outDir, unit.name);
    writeFileSync(target, unit.content, 'utf8');
    process.stdout.write(`已生成 ${target}\n`);
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
