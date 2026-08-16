import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PORT } from "@car/protocol";
import { DEFAULT_CONTROL_TTL_MS } from "./security/token.ts";

export interface ServerConfig {
  host: string;
  port: number;
  token: string;
  dataDir: string;
  dbPath: string;
  /** 前端构建产物目录；不存在时只提供 API。 */
  staticDir: string;
  controlTtlMs: number;
  staleAfterMs: number;
  /** 用假的 cmux 数据跑，便于没有 cmux 的环境演示 / 测试。 */
  demo: boolean;
  /** 输出最多保留多少行。 */
  maxOutputLines: number;
}

export interface ParseArgsResult {
  config: ServerConfig;
  help: boolean;
  /** 用户显式指定了 Token（命令行或环境变量）。 */
  tokenProvided: boolean;
  /** 强制换一个新的 Token，并让所有旧 Session 失效。 */
  rotateToken: boolean;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ParseArgsResult {
  const dataDir = env["CAR_DATA_DIR"] ?? join(homedir(), ".cmux-agent-remote");
  const config: ServerConfig = {
    host: env["CAR_HOST"] ?? "127.0.0.1",
    port: Number(env["CAR_PORT"] ?? DEFAULT_PORT),
    token: env["CAR_TOKEN"] ?? "",
    dataDir,
    dbPath: env["CAR_DB"] ?? join(dataDir, "state.db"),
    staticDir: env["CAR_STATIC_DIR"] ?? "",
    controlTtlMs: Number(env["CAR_CONTROL_TTL_MS"] ?? DEFAULT_CONTROL_TTL_MS),
    staleAfterMs: Number(env["CAR_STALE_AFTER_MS"] ?? 10 * 60 * 1000),
    demo: env["CAR_DEMO"] === "1",
    maxOutputLines: Number(env["CAR_MAX_OUTPUT_LINES"] ?? 400),
  };
  let help = false;
  let tokenProvided = config.token.length > 0;
  let rotateToken = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--port":
        config.port = Number(next());
        break;
      case "--host":
        config.host = next();
        break;
      case "--lan":
        // 局域网测试：0.0.0.0:4318（需求文档 §16）
        config.host = "0.0.0.0";
        break;
      case "--token":
        config.token = next();
        tokenProvided = config.token.length > 0;
        break;
      case "--rotate-token":
        rotateToken = true;
        break;
      case "--db":
        config.dbPath = next();
        break;
      case "--static":
        config.staticDir = next();
        break;
      case "--demo":
        config.demo = true;
        break;
      default:
        break;
    }
  }

  if (!Number.isFinite(config.port) || config.port <= 0) config.port = DEFAULT_PORT;

  return { config, help, tokenProvided, rotateToken };
}

export const HELP_TEXT = `CMUX Agent Remote

用法:
  cmux-agent-remote [options]

选项:
  --port <n>       监听端口（默认 4318）
  --host <addr>    监听地址（默认 127.0.0.1）
  --lan            监听 0.0.0.0，供同一 Wi-Fi 下的手机访问
  --token <token>  指定 Access Token（默认首次启动随机生成后复用）
  --rotate-token   重新生成 Access Token，并让所有已登录设备失效
  --db <path>      SQLite 路径（默认 ~/.cmux-agent-remote/state.db）
  --static <dir>   前端静态文件目录
  --demo           使用内置假数据（没有 cmux 也能跑）
  -h, --help       显示帮助
`;
