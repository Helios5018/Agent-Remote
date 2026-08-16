import type { CmuxKey, CmuxTree, SurfaceSnapshot } from "@car/protocol";
import type { CmuxClient, ReadSurfaceOptions } from "./client.ts";
import { SnapshotTracker } from "./output.ts";

/**
 * 假的 cmux（--demo）。
 *
 * 两个用途：
 * 1. 在没有 cmux 的机器上演示 / 跑集成测试。
 * 2. 单测里精确控制拓扑与输出。
 */
export interface FakeSurfaceSpec {
  id: string;
  ref: string;
  title: string;
  agent: "claude" | "codex" | "grok" | null;
  pid?: number;
  content: string;
}

export interface FakeWorkspaceSpec {
  id: string;
  ref: string;
  title: string;
  panes: Array<{ ref: string; id?: string; surfaces: FakeSurfaceSpec[] }>;
}

export class FakeCmuxClient implements CmuxClient {
  readonly sentText: Array<{ surfaceId: string; text: string }> = [];
  readonly sentKeys: Array<{ surfaceId: string; key: CmuxKey }> = [];
  private readonly snapshots = new SnapshotTracker();
  available = true;

  constructor(
    private workspaces: FakeWorkspaceSpec[] = defaultWorkspaces(),
    private readonly now: () => number = Date.now,
  ) {}

  async ping(): Promise<boolean> {
    return this.available;
  }

  async getTree(): Promise<CmuxTree> {
    const pidIndex: Record<string, string> = {};
    const tree: CmuxTree = {
      fetchedAt: this.now(),
      pidIndex,
      workspaces: this.workspaces.map((workspace, wIndex) => ({
        id: workspace.id,
        ref: workspace.ref,
        index: wIndex,
        title: workspace.title,
        description: null,
        selected: wIndex === 0,
        windowRef: "window:1",
        panes: workspace.panes.map((pane, pIndex) => ({
          id: pane.id,
          ref: pane.ref,
          index: pIndex,
          focused: pIndex === 0,
          surfaces: pane.surfaces.map((surface, sIndex) => {
            if (surface.pid) pidIndex[String(surface.pid)] = surface.id;
            return {
              id: surface.id,
              ref: surface.ref,
              paneId: pane.id,
              paneRef: pane.ref,
              workspaceId: workspace.id,
              workspaceRef: workspace.ref,
              title: surface.title,
              type: "terminal",
              tty: null,
              focused: false,
              selected: sIndex === 0,
              index: sIndex,
              agent: surface.agent,
              agentPid: surface.pid ?? null,
            };
          }),
        })),
      })),
    };
    return tree;
  }

  async readSurface(surfaceId: string, _options: ReadSurfaceOptions = {}): Promise<SurfaceSnapshot> {
    const surface = this.findSurface(surfaceId);
    if (!surface) throw new Error(`surface not found: ${surfaceId}`);
    const { snapshot } = this.snapshots.update(surfaceId, surface.content, this.now());
    return snapshot;
  }

  async sendText(surfaceId: string, text: string): Promise<void> {
    const surface = this.findSurface(surfaceId);
    if (!surface) throw new Error(`surface not found: ${surfaceId}`);
    this.sentText.push({ surfaceId, text });
    surface.content = `${surface.content}\n> ${text}`;
  }

  async sendKey(surfaceId: string, key: CmuxKey): Promise<void> {
    const surface = this.findSurface(surfaceId);
    if (!surface) throw new Error(`surface not found: ${surfaceId}`);
    this.sentKeys.push({ surfaceId, key });
  }

  // ---- 测试辅助 ----

  findSurface(surfaceId: string): FakeSurfaceSpec | undefined {
    for (const workspace of this.workspaces) {
      for (const pane of workspace.panes) {
        for (const surface of pane.surfaces) {
          if (surface.id === surfaceId || surface.ref === surfaceId) return surface;
        }
      }
    }
    return undefined;
  }

  appendOutput(surfaceId: string, text: string): void {
    const surface = this.findSurface(surfaceId);
    if (surface) surface.content = `${surface.content}\n${text}`;
  }

  removeSurface(surfaceId: string): void {
    for (const workspace of this.workspaces) {
      for (const pane of workspace.panes) {
        pane.surfaces = pane.surfaces.filter((surface) => surface.id !== surfaceId);
      }
    }
  }

  setWorkspaces(workspaces: FakeWorkspaceSpec[]): void {
    this.workspaces = workspaces;
  }
}

export function defaultWorkspaces(): FakeWorkspaceSpec[] {
  return [
    {
      id: "ws-world-model",
      ref: "workspace:5",
      title: "世界模型 Demo",
      panes: [
        {
          ref: "pane:7",
          id: "pane-7",
          surfaces: [
            {
              id: "sf-10",
              ref: "surface:10",
              title: "codex — 世界模型 Demo",
              agent: "codex",
              pid: 51001,
              content: "$ codex\n准备就绪。",
            },
            {
              id: "sf-11",
              ref: "surface:11",
              title: "codex — 评测流水线",
              agent: "codex",
              pid: 51002,
              content: "Running pnpm test...\n\n14 tests passed\n2 tests failed",
            },
          ],
        },
        {
          ref: "pane:8",
          id: "pane-8",
          surfaces: [
            {
              id: "sf-12",
              ref: "surface:12",
              title: "zsh",
              agent: null,
              content: "$ ",
            },
          ],
        },
      ],
    },
    {
      id: "ws-eval",
      ref: "workspace:6",
      title: "业务评测平台",
      panes: [
        {
          ref: "pane:9",
          id: "pane-9",
          surfaces: [
            {
              id: "sf-20",
              ref: "surface:20",
              title: "claude — 业务评测平台",
              agent: "claude",
              pid: 52001,
              content: "我已经更新了 3 个文件，并修复了 evaluation mapping。",
            },
            {
              id: "sf-21",
              ref: "surface:21",
              title: "grok — P02 Evaluation",
              agent: "grok",
              pid: 52002,
              content: "Running command: pnpm lint",
            },
          ],
        },
      ],
    },
  ];
}
