import React, { useEffect, useMemo, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type View = "home" | "paper" | "server" | "learn" | "life";
type AgentKey = "hoot" | "bookworm" | "gears" | "scholar" | "bloom";
type Mood = "sad" | "low" | "ok" | "good" | "great";

type Paper = {
  id: string;
  title: string;
  authors: string[];
  summary: string;
  published: string;
  link: string;
  score?: number;
  savedAt?: string;
};

type Todo = {
  id: string;
  title: string;
  category: "research" | "life" | "health" | "social";
  due?: string;
  priority?: "low" | "medium" | "high";
  done: boolean;
  createdAt: string;
};

type GardenItem = {
  id: string;
  type: "flower" | "tree" | "rare" | "butterfly" | "pond";
  x: number;
  grownAt: string;
};

type ChatMessage = {
  role: "user" | "agent";
  text: string;
};

type LearningPath = {
  topic: string;
  stages: { title: string; place: string; focus: string; done: boolean }[];
};

type Tutorial = {
  title: string;
  stage: string;
  content: string;
};

type Wardrobe = Record<AgentKey, string>;
type SpriteCrop = {
  src: string;
  width: number;
  height: number;
  sheetWidth: number;
  x: number;
  y: number;
  label: string;
};

type AppState = {
  view: View;
  stars: number;
  savedPapers: Paper[];
  todos: Todo[];
  garden: GardenItem[];
  moods: { date: string; mood: Mood; note: string }[];
  chat: ChatMessage[];
  wardrobe: Wardrobe;
  learningPath: LearningPath | null;
};

type Action =
  | { type: "hydrate"; payload: Partial<AppState> }
  | { type: "view"; view: View }
  | { type: "stars"; amount: number }
  | { type: "savePaper"; paper: Paper }
  | { type: "addTodo"; todo: Todo }
  | { type: "toggleTodo"; id: string }
  | { type: "garden"; item: GardenItem }
  | { type: "mood"; mood: Mood; note: string }
  | { type: "chat"; message: ChatMessage }
  | { type: "wardrobe"; agent: AgentKey; outfit: string }
  | { type: "learning"; path: LearningPath }
  | { type: "learningStage"; index: number; done: boolean };

const initialState: AppState = {
  view: "home",
  stars: 80,
  savedPapers: [],
  todos: [],
  garden: [
    { id: "starter-flower", type: "flower", x: 12, grownAt: new Date().toISOString() },
    { id: "starter-tree", type: "tree", x: 58, grownAt: new Date().toISOString() },
  ],
  moods: [],
  chat: [
    {
      role: "agent",
      text: "Hoo~ 欢迎来到 RAIO。你可以让我找论文、拆学习路径、看服务器输出，或者先种下一颗 Todo 种子。",
    },
  ],
  wardrobe: {
    hoot: "scarf",
    bookworm: "academic",
    gears: "work",
    scholar: "star",
    bloom: "garden",
  },
  learningPath: null,
};

const AGENTS: Record<AgentKey, { name: string; title: string; color: string; view?: View; line: string }> = {
  hoot: { name: "Lumo", title: "守夜精灵", color: "#bb88ff", view: "home", line: "我会把混乱的科研日常整理成一张小地图。" },
  bookworm: { name: "Bookworm", title: "书虫", color: "#6dc2ff", view: "paper", line: "告诉我研究问题，我去书架深处翻一翻。" },
  gears: { name: "Gears", title: "机械师", color: "#ffaa33", view: "server", line: "把 nvidia-smi 输出贴过来，温度和显存我来盯。" },
  scholar: { name: "Scholar", title: "学者", color: "#88dd55", view: "learn", line: "给我一个主题，我给你铺一条从新手村到大师殿堂的路。" },
  bloom: { name: "Bloom", title: "园丁", color: "#ff88aa", view: "life", line: "完成任务会开花，记录心情会有蝴蝶飞过。" },
};

const OUTFITS: Record<AgentKey, { key: string; label: string; cost: number }[]> = {
  hoot: [
    { key: "scarf", label: "基础围巾", cost: 0 },
    { key: "gentleman", label: "绅士礼帽", cost: 100 },
    { key: "starlord", label: "星露之冠", cost: 500 },
    { key: "junimo", label: "祝尼魔斗篷", cost: 220 },
    { key: "mayor", label: "镇长礼服", cost: 360 },
  ],
  bookworm: [
    { key: "academic", label: "毕业学袍", cost: 0 },
    { key: "lab", label: "实验白大褂", cost: 120 },
    { key: "nobel", label: "诺贝尔金装", cost: 500 },
    { key: "library", label: "图书馆围裙", cost: 180 },
    { key: "ancient", label: "古代种子袍", cost: 320 },
  ],
  gears: [
    { key: "work", label: "基础工装", cost: 0 },
    { key: "lightning", label: "闪电战甲", cost: 120 },
    { key: "cryo", label: "液氮冷却装", cost: 240 },
    { key: "blacksmith", label: "铁匠围裙", cost: 160 },
    { key: "iridium", label: "铱矿护甲", cost: 460 },
  ],
  scholar: [
    { key: "star", label: "星空斗篷", cost: 0 },
    { key: "alchemy", label: "炼金术士袍", cost: 160 },
    { key: "archmage", label: "大魔法师", cost: 420 },
    { key: "wizard", label: "法师塔长袍", cost: 260 },
    { key: "galaxy", label: "银河学者", cost: 520 },
  ],
  bloom: [
    { key: "garden", label: "基础草帽", cost: 0 },
    { key: "sakura", label: "樱花和服", cost: 120 },
    { key: "rainbow", label: "彩虹花仙子", cost: 500 },
    { key: "junimo", label: "森林小精灵", cost: 200 },
    { key: "harvest", label: "丰收节盛装", cost: 360 },
  ],
};

const WORKSPACE_SCENES: Record<Exclude<View, "home">, { title: string; map: string; prop: SpriteCrop; agent: AgentKey; tone: string }> = {
  paper: {
    title: "图书馆阅读桌",
    map: "Maps/townInterior..png",
    prop: { src: "LooseSprites/JunimoNote..png", width: 64, height: 64, sheetWidth: 640, x: 0, y: 0, label: "笔记" },
    agent: "bookworm",
    tone: "library",
  },
  server: {
    title: "铁匠铺控制台",
    map: "Maps/spring_BusStop..png",
    prop: { src: "TileSheets/tools..png", width: 16, height: 16, sheetWidth: 336, x: 0, y: 0, label: "工具" },
    agent: "gears",
    tone: "forge",
  },
  learn: {
    title: "法师塔课堂",
    map: "Maps/WizardHouseTiles..png",
    prop: { src: "TileSheets/emotes..png", width: 16, height: 16, sheetWidth: 64, x: 0, y: 16, label: "灵感" },
    agent: "scholar",
    tone: "tower",
  },
  life: {
    title: "温室与农场日历",
    map: "Maps/GreenHouseInterior..png",
    prop: { src: "TileSheets/crops..png", width: 16, height: 16, sheetWidth: 256, x: 32, y: 48, label: "作物" },
    agent: "bloom",
    tone: "greenhouse",
  },
};

const AGENT_SPRITES: Record<AgentKey, SpriteCrop> = {
  hoot: { src: "Characters/Junimo..png", width: 16, height: 16, sheetWidth: 128, x: 0, y: 0, label: "Lumo" },
  bookworm: { src: "Characters/Penny..png", width: 16, height: 32, sheetWidth: 64, x: 0, y: 0, label: "Bookworm" },
  gears: { src: "Characters/Clint..png", width: 16, height: 32, sheetWidth: 64, x: 0, y: 0, label: "Gears" },
  scholar: { src: "Characters/Wizard..png", width: 16, height: 32, sheetWidth: 64, x: 0, y: 0, label: "Scholar" },
  bloom: { src: "Characters/Robin..png", width: 16, height: 32, sheetWidth: 64, x: 0, y: 0, label: "Bloom" },
};

const CATEGORY_LABELS = {
  research: "科研",
  life: "生活",
  health: "健康",
  social: "社交",
};

const SAMPLE_NVIDIA_SMI = `+-----------------------------------------------------------------------------+
| NVIDIA-SMI 550.54       Driver Version: 550.54       CUDA Version: 12.4     |
|-------------------------------+----------------------+----------------------+
|   0  NVIDIA A100-SXM4-80GB  On | 00000000:81:00.0 Off |                    0 |
| 42%   66C    P0   300W / 400W | 51200MiB / 81920MiB  |     91%      Default |
|-------------------------------+----------------------+----------------------+
|   1  NVIDIA A100-SXM4-80GB  On | 00000000:82:00.0 Off |                    0 |
| 34%   78C    P0   275W / 400W | 71680MiB / 81920MiB  |     97%      Default |
+-----------------------------------------------------------------------------+`;

const OPS_COMMANDS = [
  { title: "GPU 快照", command: "watch -n 2 nvidia-smi" },
  { title: "按显存查进程", command: "nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv" },
  { title: "训练日志尾部", command: "tail -f logs/train.log" },
  { title: "后台运行", command: "nohup bash train.sh > logs/train.log 2>&1 &" },
];

const SSH_PRESETS = [
  { title: "GPU 状态", command: "nvidia-smi" },
  { title: "CPU/内存", command: "top -bn1 | head -40" },
  { title: "磁盘空间", command: "df -h" },
  { title: "我的进程", command: "ps -u $USER -o pid,ppid,stat,etime,%cpu,%mem,cmd --sort=-%cpu | head -30" },
  { title: "Python 环境", command: "which python && python --version && which conda || true" },
];

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return { ...state, ...action.payload };
    case "view":
      return { ...state, view: action.view };
    case "stars":
      return { ...state, stars: Math.max(0, state.stars + action.amount) };
    case "savePaper":
      if (state.savedPapers.some((paper) => paper.id === action.paper.id)) return state;
      return { ...state, savedPapers: [{ ...action.paper, savedAt: new Date().toISOString() }, ...state.savedPapers] };
    case "addTodo":
      return { ...state, todos: [action.todo, ...state.todos] };
    case "toggleTodo": {
      const todos = state.todos.map((todo) => (todo.id === action.id ? { ...todo, done: !todo.done } : todo));
      return { ...state, todos };
    }
    case "garden":
      return { ...state, garden: [...state.garden, action.item] };
    case "mood":
      return {
        ...state,
        moods: [{ date: new Date().toISOString().slice(0, 10), mood: action.mood, note: action.note }, ...state.moods],
      };
    case "chat":
      return { ...state, chat: [...state.chat, action.message] };
    case "wardrobe":
      return { ...state, wardrobe: { ...state.wardrobe, [action.agent]: action.outfit } };
    case "learning":
      return { ...state, learningPath: action.path };
    case "learningStage":
      if (!state.learningPath) return state;
      return {
        ...state,
        learningPath: {
          ...state.learningPath,
          stages: state.learningPath.stages.map((stage, index) => index === action.index ? { ...stage, done: action.done } : stage),
        },
      };
    default:
      return state;
  }
}

function usePersistentState() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("raio:state");
    if (raw) {
      try {
        dispatch({ type: "hydrate", payload: JSON.parse(raw) });
      } catch {
        localStorage.removeItem("raio:state");
      }
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem("raio:state", JSON.stringify(state));
  }, [ready, state]);

  return [state, dispatch] as const;
}

function todayGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "凌晨好，记得让人类身体也有 checkpoint";
  if (hour < 12) return "早上好，适合处理最硬的任务";
  if (hour < 18) return "下午好，适合推进实验和复盘";
  return "晚上好，别把自己跑成过热 GPU";
}

function dayCount() {
  const start = new Date("2026-05-28T00:00:00");
  return Math.max(1, Math.floor((Date.now() - start.getTime()) / 86400000) + 1);
}

function stardewAsset(path: string) {
  return `/assets/stardew/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function matrixToShadow(matrix: (string | null)[][], pixelSize: number) {
  return matrix
    .flatMap((row, y) =>
      row.map((color, x) => (color ? `${x * pixelSize}px ${y * pixelSize}px 0 ${color}` : "")).filter(Boolean),
    )
    .join(",");
}

function layer(width: number, height: number, fill: (x: number, y: number) => string | null) {
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => fill(x, y)));
}

function mergeLayers(layers: (string | null)[][][]) {
  const merged = layers[0].map((row) => [...row]);
  layers.slice(1).forEach((current) => {
    current.forEach((row, y) => row.forEach((color, x) => {
      if (color) merged[y][x] = color;
    }));
  });
  return merged;
}

function spriteMatrix(agent: AgentKey, outfit: string) {
  const skin = "#ffd5b3";
  const skinShade = "#e7ad86";
  const outline = "#1a1a2e";
  const hair = "#5a3b25";
  const hairHi = "#7a5338";
  const shoe = "#191726";
  const baseColors: Record<AgentKey, string> = {
    hoot: outfit === "starlord" ? "#1a1b4e" : "#8b6914",
    bookworm: outfit === "lab" ? "#f2f2f2" : outfit === "nobel" ? "#ffd700" : "#6dc2ff",
    gears: outfit === "lightning" ? "#4488ff" : outfit === "cryo" ? "#88ddff" : "#ffaa33",
    scholar: outfit === "alchemy" ? "#cc8844" : outfit === "archmage" ? "#ff4488" : "#bb88ff",
    bloom: outfit === "sakura" ? "#ffb7c5" : outfit === "rainbow" ? "#88dd55" : "#66cc44",
  };
  const accent = AGENTS[agent].color;
  const shade: Record<AgentKey, string> = {
    hoot: outfit === "starlord" ? "#11143a" : "#6b4f10",
    bookworm: outfit === "lab" ? "#d7d8e4" : outfit === "nobel" ? "#c99020" : "#3f91d0",
    gears: outfit === "lightning" ? "#235cbb" : outfit === "cryo" ? "#49a9d2" : "#d98516",
    scholar: outfit === "alchemy" ? "#925b29" : outfit === "archmage" ? "#b81f5a" : "#744ac9",
    bloom: outfit === "sakura" ? "#db7e99" : outfit === "rainbow" ? "#3fa83d" : "#439b35",
  };
  const body = layer(20, 24, (x, y) => {
    if (agent === "hoot") {
      if ((y === 1 && (x === 5 || x === 14)) || (y === 2 && ((x >= 4 && x <= 6) || (x >= 13 && x <= 15)))) return shade.hoot;
      if (y >= 3 && y <= 17 && x >= 3 && x <= 16 && Math.abs(x - 9.5) / 1.1 + Math.abs(y - 10) / 1.3 < 8) return x < 5 || x > 14 || y > 14 ? shade.hoot : baseColors.hoot;
      if (y >= 10 && y <= 17 && x >= 6 && x <= 13 && Math.abs(x - 9.5) + Math.abs(y - 14) < 6) return "#f5e6c8";
      if ((y === 7 || y === 8) && (x === 6 || x === 13)) return "#ffdd44";
      if ((y === 7 || y === 8) && (x === 7 || x === 12)) return outline;
      if (y === 9 && x >= 8 && x <= 11) return "#ffaa33";
      if ((y === 11 || y === 12) && (x === 2 || x === 17)) return shade.hoot;
      if (y === 18 && x >= 7 && x <= 12) return accent;
      if (y === 22 && (x === 7 || x === 12)) return "#6b4f10";
      return null;
    }
    if (y >= 4 && y <= 8 && x >= 6 && x <= 13) {
      if (x === 6 || x === 13 || y === 8) return skinShade;
      return skin;
    }
    if (agent !== "gears" && agent !== "scholar" && agent !== "bloom" && y >= 2 && y <= 5 && x >= 5 && x <= 14) return x === 5 || x === 14 || y === 2 ? hair : hairHi;
    if (agent === "gears" && y >= 1 && y <= 4 && x >= 4 && x <= 15) return y === 4 || x === 4 || x === 15 ? "#d98516" : "#ffaa33";
    if (agent === "scholar" && ((y === 0 && x === 10) || (y === 1 && x >= 9 && x <= 11) || (y === 2 && x >= 8 && x <= 12) || (y === 3 && x >= 6 && x <= 14) || (y === 4 && x >= 4 && x <= 16))) return y === 4 ? "#5d35aa" : "#744ac9";
    if (agent === "bloom" && ((y >= 1 && y <= 3 && x >= 6 && x <= 13) || (y === 4 && x >= 3 && x <= 16))) return y === 4 ? "#d9b873" : "#f5deb3";
    if (y === 6 && (x === 8 || x === 11)) return outline;
    if (agent === "bookworm" && y === 6 && x >= 6 && x <= 13) return x === 9 || x === 10 ? skin : "#30324d";
    if (y >= 10 && y <= 18 && x >= 5 && x <= 14) {
      if (x === 5 || x === 14 || y === 18) return shade[agent];
      return baseColors[agent];
    }
    if (y >= 19 && y <= 21 && ((x >= 6 && x <= 8) || (x >= 11 && x <= 13))) return y === 21 ? shoe : shade[agent];
    if (y === 22 && ((x >= 5 && x <= 8) || (x >= 11 && x <= 14))) return shoe;
    return null;
  });
  const details = layer(20, 24, (x, y) => {
    if (agent === "bookworm" && y >= 13 && y <= 16 && x >= 2 && x <= 6) return x === 2 || y === 16 ? "#8b4513" : "#fff5e6";
    if (agent === "bookworm" && y === 11 && x >= 7 && x <= 12) return outfit === "nobel" ? "#fff3a0" : "#e8f6ff";
    if (agent === "gears" && ((x === 15 && y >= 11 && y <= 17) || (x === 16 && y === 11) || (x === 17 && y === 10))) return y === 10 ? "#b8c5d1" : "#8899aa";
    if (agent === "gears" && y === 13 && x >= 7 && x <= 12) return "#667788";
    if (agent === "scholar" && ((x === 15 && y >= 11 && y <= 17) || (x === 16 && y === 10))) return y === 10 ? "#ffdd44" : "#8b4513";
    if (agent === "scholar" && ((x + y) % 9 === 0) && y >= 10 && y <= 17 && x >= 6 && x <= 13) return "#ffdd44";
    if (agent === "bloom" && ((x === 15 && y >= 12 && y <= 17) || (x === 16 && y === 13) || (x === 17 && y === 14))) return "#8899aa";
    if (agent === "bloom" && y === 11 && x >= 8 && x <= 11) return "#ffaacc";
    if (outfit === "gentleman" && agent === "hoot" && y <= 3 && x >= 6 && x <= 13) return y === 3 ? "#333344" : "#111827";
    if (outfit === "starlord" && agent === "hoot" && y === 2 && x >= 7 && x <= 12) return "#ffd700";
    if (outfit === "nobel" && agent === "bookworm" && ((x + y) % 6 === 0) && y >= 10 && y <= 18) return "#fff5a6";
    if (outfit === "rainbow" && agent === "bloom" && y >= 10 && y <= 18 && x >= 5 && x <= 14) return ["#ff6666", "#ffaa33", "#ffdd44", "#66cc44", "#6dc2ff", "#bb88ff"][x % 6];
    if (outfit === "lab" && agent === "bookworm" && y >= 12 && y <= 18 && (x === 6 || x === 13)) return "#b9d8f0";
    if (outfit === "cryo" && agent === "gears" && y >= 9 && y <= 12 && x >= 6 && x <= 13 && (x + y) % 3 === 0) return "#e5fbff";
    if (outfit === "archmage" && agent === "scholar" && y >= 5 && y <= 8 && x >= 7 && x <= 12) return "#ffd1e3";
    return null;
  });
  return mergeLayers([body, details]);
}

function PixelAgent({ agent, size = 4, mood = "idle" }: { agent: AgentKey; outfit?: string; size?: number; mood?: string }) {
  const sprite = AGENT_SPRITES[agent];
  return (
    <div className={`agent-stage ${mood}`}>
      {mood === "thinking" && <div className="thinking-bubble">...</div>}
      <div
        className="agent-sprite"
        style={{
          width: sprite.width * size,
          height: sprite.height * size,
          backgroundImage: `url("${stardewAsset(sprite.src)}")`,
          backgroundSize: `${sprite.sheetWidth * size}px auto`,
          backgroundPosition: `${-sprite.x * size}px ${-sprite.y * size}px`,
        }}
      />
    </div>
  );
}

function PixelProp({ src, className = "" }: { src: string; className?: string }) {
  return <img className={`pixel-prop ${className}`} src={stardewAsset(src)} alt="" loading="lazy" />;
}

function SheetSprite({ sprite, scale = 3, className = "" }: { sprite: SpriteCrop; scale?: number; className?: string }) {
  return (
    <span
      className={`sheet-sprite ${className}`}
      title={sprite.label}
      style={{
        width: sprite.width * scale,
        height: sprite.height * scale,
        backgroundImage: `url("${stardewAsset(sprite.src)}")`,
        backgroundSize: `${sprite.sheetWidth * scale}px auto`,
        backgroundPosition: `${-sprite.x * scale}px ${-sprite.y * scale}px`,
      }}
    />
  );
}

function App() {
  const [state, dispatch] = usePersistentState();
  const [starFly, setStarFly] = useState<number | null>(null);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);

  const activeAgent = useMemo<AgentKey>(() => {
    if (state.view === "paper") return "bookworm";
    if (state.view === "server") return "gears";
    if (state.view === "learn") return "scholar";
    if (state.view === "life") return "bloom";
    return "hoot";
  }, [state.view]);

  const award = (amount: number) => {
    dispatch({ type: "stars", amount });
    setStarFly(amount);
    window.setTimeout(() => setStarFly(null), 1200);
  };

  return (
    <main className="app-shell">
      <StarField />
      <HUD stars={state.stars} starFly={starFly} />
      <div className="workbench">
        <NavBar state={state} dispatch={dispatch} activeAgent={activeAgent} onWardrobe={() => setWardrobeOpen(true)} />
        <section className="main-panel">
          {state.view === "home" && <HomePage state={state} dispatch={dispatch} award={award} />}
          {state.view === "paper" && <PaperPage state={state} dispatch={dispatch} award={award} />}
          {state.view === "server" && <ServerPage award={award} />}
          {state.view === "learn" && <LearningPage state={state} dispatch={dispatch} award={award} />}
          {state.view === "life" && <LifePage state={state} dispatch={dispatch} award={award} />}
        </section>
      </div>
      {wardrobeOpen && <WardrobePanel state={state} dispatch={dispatch} onClose={() => setWardrobeOpen(false)} />}
    </main>
  );
}

function StarField() {
  return <div className="starfield">{Array.from({ length: 32 }, (_, i) => <span key={i} />)}</div>;
}

function HUD({ stars, starFly }: { stars: number; starFly: number | null }) {
  return (
    <header className="hud">
      <div className="brand">RAIO v1.0</div>
      <div className="hud-chip">Day {dayCount()}</div>
      <div className="hud-chip">{todayGreeting()}</div>
      <div className="star-counter">★ {stars}{starFly && <span className="star-fly">+{starFly}★</span>}</div>
    </header>
  );
}

function NavBar({
  state,
  dispatch,
  activeAgent,
  onWardrobe,
}: {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  activeAgent: AgentKey;
  onWardrobe: () => void;
}) {
  const entries: { view: View; label: string; icon: string }[] = [
    { view: "home", label: "Home", icon: "⌂" },
    { view: "paper", label: "Paper", icon: "▤" },
    { view: "server", label: "Server", icon: "▣" },
    { view: "learn", label: "Learn", icon: "✦" },
    { view: "life", label: "Life", icon: "✿" },
  ];
  return (
    <aside className="nav pixel-panel">
      {entries.map((entry) => (
        <button
          className={`nav-item ${state.view === entry.view ? "active" : ""}`}
          key={entry.view}
          onClick={() => dispatch({ type: "view", view: entry.view })}
        >
          <span>{entry.icon}</span>
          {entry.label}
        </button>
      ))}
      <div className="nav-agent">
        <PixelAgent agent={activeAgent} outfit={state.wardrobe[activeAgent]} size={3} />
        <strong>{AGENTS[activeAgent].title}</strong>
        <p>{AGENTS[activeAgent].line}</p>
        <button className="pixel-btn small" onClick={onWardrobe}>衣柜</button>
      </div>
    </aside>
  );
}

function HomePage({ state, dispatch, award }: { state: AppState; dispatch: React.Dispatch<Action>; award: (n: number) => void }) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const fallbackReply = (text: string) => {
    const lower = text.toLowerCase();
    return lower.includes("paper") || text.includes("论文")
      ? "我闻到了文献综述的味道。去 Paper 找书虫吧，我也可以帮你把问题拆成几个检索角度。"
      : lower.includes("gpu") || text.includes("服务器")
        ? "机械师已经把扳手擦亮了。把 nvidia-smi 输出贴过去，他会给你一份状态诊断。"
        : lower.includes("learn") || text.includes("学")
          ? "学者适合处理这种问题。给他一个主题，他会画出 RPG 学习地图。"
          : "收到。我会先帮你把这件事放到科研小镇的待办板上，别让它在脑子里占内存。";
  };
  const send = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    dispatch({ type: "chat", message: { role: "user", text } });
    setInput("");
    setSending(true);
    try {
      const reply = await callMaaS(
        "hoot",
        `用户当前状态：收藏论文 ${state.savedPapers.length} 篇，未完成 Todo ${state.todos.filter((todo) => !todo.done).length} 个，花园成果 ${state.garden.length} 个。\n用户说：${text}\n请像 RAIO 中央调度 Agent 一样回答，并给出下一步建议。`,
      );
      dispatch({ type: "chat", message: { role: "agent", text: reply || fallbackReply(text) } });
    } catch {
      dispatch({ type: "chat", message: { role: "agent", text: fallbackReply(text) } });
    } finally {
      setSending(false);
      award(3);
    }
  };
  return (
    <div className="page-grid home-grid">
      <section className="hero pixel-panel">
        <div>
          <p className="eyebrow">Research All-in-One</p>
          <h1>RAIO 科研生存套件</h1>
          <DialogBox agent="hoot" outfit={state.wardrobe.hoot}>
            Lumo：{todayGreeting()}。你有 {state.savedPapers.length} 篇收藏论文、{state.todos.filter((t) => !t.done).length} 个待办，花园里已经长出 {state.garden.length} 个小成果。
          </DialogBox>
        </div>
        <PixelAgent agent="hoot" outfit={state.wardrobe.hoot} size={6} />
      </section>
      <section className="pixel-panel stats-grid">
        <StatusCard label="待读论文" value={`${state.savedPapers.length}`} accent="#6dc2ff" />
        <StatusCard label="待办种子" value={`${state.todos.filter((todo) => !todo.done).length}`} accent="#ff88aa" />
        <StatusCard label="花园成果" value={`${state.garden.length}`} accent="#88dd55" />
        <StatusCard label="星星余额" value={`${state.stars}`} accent="#ffdd44" />
      </section>
      <AgentRoster state={state} dispatch={dispatch} />
      <AchievementBoard state={state} />
      <section className="pixel-panel chat-panel">
        <h2>和 Lumo 聊聊</h2>
        <div className="chat-log">
          {state.chat.slice(-6).map((message, index) => (
            <div key={`${message.role}-${index}`} className={`chat-line ${message.role}`}>{message.text}</div>
          ))}
        </div>
        <div className="input-row">
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="例如：帮我规划 LoRA 微调学习路线" onKeyDown={(event) => event.key === "Enter" && send()} />
          <button className="pixel-btn" onClick={send} disabled={sending}>{sending ? "思考中" : "发送"}</button>
        </div>
      </section>
    </div>
  );
}

function StatusCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return <div className="status-card" style={{ borderColor: accent }}><span>{label}</span><strong>{value}</strong></div>;
}

function AgentRoster({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<Action> }) {
  const agents: { agent: AgentKey; view: View; scene: string }[] = [
    { agent: "bookworm", view: "paper", scene: "Paper Agent" },
    { agent: "gears", view: "server", scene: "Server Agent" },
    { agent: "scholar", view: "learn", scene: "Learning Agent" },
    { agent: "bloom", view: "life", scene: "Life Agent" },
  ];
  return (
    <section className="pixel-panel agent-roster">
      {agents.map((item) => (
        <button className="agent-card" onClick={() => dispatch({ type: "view", view: item.view })} key={item.agent}>
          <PixelAgent agent={item.agent} outfit={state.wardrobe[item.agent]} size={3} />
          <span>{item.scene}</span>
          <strong>{AGENTS[item.agent].title}</strong>
          <em>{AGENTS[item.agent].line}</em>
        </button>
      ))}
    </section>
  );
}

function AchievementBoard({ state }: { state: AppState }) {
  const unlockedOutfits = (Object.keys(state.wardrobe) as AgentKey[]).filter((agent) => state.wardrobe[agent] !== OUTFITS[agent][0].key).length;
  const achievements = [
    { title: "图书馆开张", detail: "收藏 3 篇论文", done: state.savedPapers.length >= 3, icon: "▤" },
    { title: "农场晨会", detail: "记录 5 个 Todo", done: state.todos.length >= 5, icon: "◆" },
    { title: "温室天气", detail: "记录 3 次心情", done: state.moods.length >= 3, icon: "✿" },
    { title: "全员换装", detail: "至少 3 位 Agent 换装", done: unlockedOutfits >= 3, icon: "★" },
    { title: "大师路线", detail: "完成学习路径 3 阶段", done: (state.learningPath?.stages.filter((stage) => stage.done).length || 0) >= 3, icon: "✦" },
    { title: "丰收仓库", detail: "花园达到 12 个成果", done: state.garden.length >= 12, icon: "▣" },
  ];
  return (
    <section className="pixel-panel achievement-board">
      <h2>成就公告栏</h2>
      <div className="achievement-grid">
        {achievements.map((item) => (
          <div className={`achievement ${item.done ? "done" : ""}`} key={item.title}>
            <span>{item.icon}</span>
            <strong>{item.title}</strong>
            <em>{item.done ? "已点亮" : item.detail}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function DialogBox({ agent, outfit, children }: { agent: AgentKey; outfit: string; children: React.ReactNode }) {
  return (
    <div className="dialog-wrap">
      <PixelAgent agent={agent} outfit={outfit} size={3} mood="talking" />
      <div className="pixel-dialog">{children}</div>
    </div>
  );
}

function WorkspaceScene({ view, outfit, busy = false }: { view: Exclude<View, "home">; outfit: string; busy?: boolean }) {
  const scene = WORKSPACE_SCENES[view];
  return (
    <div className={`workspace-scene ${scene.tone}`}>
      <div className="workspace-worker">
        <PixelAgent agent={scene.agent} outfit={outfit} size={4} mood={busy ? "thinking" : "idle"} />
      </div>
    </div>
  );
}

async function callMaaS(agent: AgentKey, userContent: string, options?: { system?: string; maxTokens?: number }) {
  const response = await fetch("/api/maas/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent,
      system: options?.system,
      max_tokens: options?.maxTokens ?? 900,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "MaaS request failed");
  return String(data.text || "").trim();
}

function extractJsonObject<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function searchArxiv(query: string): Promise<Paper[]> {
  const response = await fetch(`/api/papers/arxiv?q=${encodeURIComponent(query)}&max=10`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "arXiv request failed");
  return Array.isArray(data.papers) ? data.papers : [];
}

function fallbackPapers(query: string): Paper[] {
  return [
    "Survey of Large Language Models for Scientific Discovery",
    "Retrieval-Augmented Research Assistants: Methods and Benchmarks",
    "Agentic Workflows for Literature Review and Experiment Planning",
  ].map((title, index) => ({
    id: `demo-${index + 1}`,
    title: `${title}: ${query}`,
    authors: ["RAIO Demo", "Bookworm Agent"],
    summary: "当前浏览器无法访问 arXiv 时，RAIO 会保留完整搜索体验并展示可收藏的示例结果。联网后会自动返回真实 arXiv 条目。",
    published: new Date().toISOString(),
    link: "https://arxiv.org",
    score: 9 - index,
  }));
}

function PaperPage({ state, dispatch, award }: { state: AppState; dispatch: React.Dispatch<Action>; award: (n: number) => void }) {
  const [query, setQuery] = useState("large language model code generation");
  const [status, setStatus] = useState("书虫正在等你的研究问题。");
  const [mapSummary, setMapSummary] = useState("这个方向可以先按三条线阅读：核心方法、评测基准、应用场景。优先看高分论文，再把不懂的概念送去 Learning Agent 生成学习路径。");
  const [subQueries, setSubQueries] = useState<string[]>([]);
  const [paperQuestion, setPaperQuestion] = useState("这批论文里最值得优先读哪三篇？");
  const [paperAnswer, setPaperAnswer] = useState("收藏或搜索论文后，可以在这里问书虫一个阅读问题。");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);
  const runSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setStatus("正在拆解问题：主题词、方法、benchmark、survey...");
    const localSubQueries = [
      query.trim(),
      `${query.trim()} benchmark survey`,
      `${query.trim()} recent method arxiv`,
      `${query.trim()} limitation future work`,
    ];
    setSubQueries(localSubQueries);
    try {
      const results = await searchArxiv(query.trim());
      const nextPapers = results.length ? results : fallbackPapers(query);
      setPapers(nextPapers);
      setStatus(`找到了 ${nextPapers.length} 篇候选论文，正在让 MaaS 生成文献地图...`);
      try {
        const summary = await callMaaS(
          "bookworm",
          `用户研究问题：${query}\n候选论文：\n${nextPapers.slice(0, 8).map((paper, index) => `${index + 1}. ${paper.title}\n摘要：${paper.summary.slice(0, 500)}`).join("\n\n")}\n\n请生成一段 120-180 字中文文献地图，指出主要方向、优先读哪类论文、下一步怎么读。`,
          { maxTokens: 700 },
        );
        if (summary) setMapSummary(summary);
        setStatus(`找到了 ${nextPapers.length} 篇候选论文，文献地图已整理。`);
      } catch {
        setStatus(`找到了 ${nextPapers.length} 篇候选论文；MaaS 暂时不可用，先展示本地文献地图。`);
      }
    } catch {
      setPapers(fallbackPapers(query));
      setStatus("arXiv 暂时不可达，我先用示例文献保持工作流可用。");
    } finally {
      setLoading(false);
      award(10);
    }
  };
  const askPaperAgent = async () => {
    const context = (papers.length ? papers : state.savedPapers).slice(0, 8);
    if (!paperQuestion.trim()) return;
    setPaperAnswer("书虫正在翻笔记...");
    try {
      const answer = await callMaaS(
        "bookworm",
        `用户问题：${paperQuestion}\n论文上下文：\n${context.map((paper, index) => `${index + 1}. ${paper.title}\n作者：${paper.authors.join(", ")}\n摘要：${paper.summary.slice(0, 650)}`).join("\n\n")}\n请用中文回答，给出可执行阅读建议。`,
        { maxTokens: 1000 },
      );
      setPaperAnswer(answer || "书虫没有找到足够上下文，先收藏几篇论文再问我。");
    } catch {
      setPaperAnswer("书虫：MaaS 暂时不可用。建议先按标题相关性和摘要方法部分筛 3 篇精读。");
    }
  };
  return (
    <div className="page-grid">
      <section className="pixel-panel module-head">
        <div>
          <p className="eyebrow">Paper Agent</p>
          <h1>书虫的图书馆</h1>
          <p>{status}</p>
        </div>
        <WorkspaceScene view="paper" outfit={state.wardrobe.bookworm} busy={loading} />
      </section>
      <section className="pixel-panel">
        <div className="input-row">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入自然语言研究问题" />
          <button className="pixel-btn" onClick={runSearch} disabled={loading}>{loading ? "搜索中" : "找论文"}</button>
        </div>
      </section>
      {subQueries.length > 0 && <section className="pixel-panel">
        <h2>查询拆解</h2>
        <div className="chip-row">
          {subQueries.map((item) => <span className="query-chip" key={item}>{item}</span>)}
        </div>
      </section>}
      {papers.length > 0 && <section className="map-card pixel-panel">
        <h2>文献地图</h2>
        <p>{mapSummary}</p>
      </section>}
      <section className="pixel-panel">
        <h2>论文问答</h2>
        <div className="input-row">
          <input value={paperQuestion} onChange={(event) => setPaperQuestion(event.target.value)} placeholder="例如：这些论文的共同 limitation 是什么？" />
          <button className="pixel-btn" onClick={askPaperAgent}>问书虫</button>
        </div>
        <p className="agent-advice">{paperAnswer}</p>
      </section>
      <section className="pixel-panel paper-vault">
        <h2>Paper Vault</h2>
        {state.savedPapers.length === 0 ? <p>书架还空着。搜索后点收藏，论文会变成这里的一本像素书。</p> : (
          <div className="bookshelf">
            {state.savedPapers.slice(0, 18).map((paper, index) => (
              <a className="pixel-book" href={paper.link} target="_blank" rel="noreferrer" title={paper.title} key={paper.id} style={{ backgroundColor: ["#6dc2ff", "#ff88aa", "#88dd55", "#ffaa33", "#bb88ff"][index % 5] }}>
                <span>{paper.title.slice(0, 18)}</span>
              </a>
            ))}
          </div>
        )}
      </section>
      <section className="paper-list">
        {papers.map((paper) => (
          <article className="paper-card pixel-panel" key={paper.id}>
            <div className="paper-score">★ {paper.score}</div>
            <h3>{paper.title}</h3>
            <p className="meta">{paper.authors.join(", ")} · {paper.published.slice(0, 10)}</p>
            <p>{paper.summary.slice(0, 360)}{paper.summary.length > 360 ? "..." : ""}</p>
            <div className="card-actions">
              <a href={paper.link} target="_blank" rel="noreferrer">打开 arXiv</a>
              <button className="pixel-btn small" onClick={() => { dispatch({ type: "savePaper", paper }); award(5); }}>收藏</button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function parseNvidiaSmi(raw: string) {
  const gpuLines = raw.split("\n").filter((line) => /MiB\s*\|/.test(line) || /\d+C/.test(line));
  return gpuLines.map((line, index) => {
    const temp = Number(line.match(/(\d+)C/)?.[1] || 0);
    const memory = line.match(/(\d+)MiB\s*\/\s*(\d+)MiB/);
    const used = Number(memory?.[1] || 0);
    const total = Number(memory?.[2] || 1);
    return { id: index, temp, used, total, util: Math.round((used / total) * 100) };
  });
}

async function runSshCommand(payload: { host: string; port: number; username: string; password: string; command: string }) {
  const response = await fetch("/api/server/ssh/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "SSH command failed");
  return data as { stdout: string; stderr: string; code: number };
}

function ServerPage({ award }: { award: (n: number) => void }) {
  const [raw, setRaw] = useState("");
  const [gpus, setGpus] = useState<ReturnType<typeof parseNvidiaSmi>>([]);
  const [advice, setAdvice] = useState("机械师：机器还没开灯，把输出贴给我看看。");
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [history, setHistory] = useState<{ at: string; count: number; hot: number; memory: number }[]>([]);
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState(22);
  const [sshUser, setSshUser] = useState("");
  const [sshPassword, setSshPassword] = useState("");
  const [sshCommand, setSshCommand] = useState("nvidia-smi");
  const [sshOutput, setSshOutput] = useState("连接远程服务器后，机械师会在这里显示命令输出。密码只用于本次本地代理请求，不保存。");
  const [sshRunning, setSshRunning] = useState(false);
  const parse = async () => {
    const next = parseNvidiaSmi(raw);
    setGpus(next);
    if (next.length) {
      setHistory((items) => [{
        at: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        count: next.length,
        hot: next.filter((gpu) => gpu.temp >= 80).length,
        memory: Math.round(next.reduce((sum, gpu) => sum + gpu.util, 0) / next.length),
      }, ...items].slice(0, 5));
    }
    award(8);
    if (!raw.trim()) return;
    setLoadingAdvice(true);
    try {
      const text = await callMaaS(
        "gears",
        `下面是用户粘贴的服务器/GPU 输出，请用中文诊断风险、资源利用、可能的下一步命令，控制在 180 字内：\n\n${raw.slice(0, 6000)}`,
        { maxTokens: 800 },
      );
      setAdvice(text || "机械师：输出解析完成，当前没有发现明显异常。");
    } catch {
      setAdvice(next.some((gpu) => gpu.temp > 85) ? "机械师：有 GPU 温度偏高，建议检查散热、风扇、进程负载和机房温度。" : "机械师：MaaS 暂时不可用，已完成本地显存/温度解析。");
    } finally {
      setLoadingAdvice(false);
    }
  };
  const executeSsh = async (command = sshCommand) => {
    if (!sshHost.trim() || !sshUser.trim() || !sshPassword || !command.trim()) {
      setSshOutput("请先填写 Host、User、Password 和命令。");
      return;
    }
    setSshRunning(true);
    setSshOutput(`$ ${command}\n正在连接 ${sshUser}@${sshHost}:${sshPort} ...`);
    try {
      const result = await runSshCommand({
        host: sshHost.trim(),
        port: sshPort || 22,
        username: sshUser.trim(),
        password: sshPassword,
        command,
      });
      const output = [`$ ${command}`, result.stdout, result.stderr ? `\n[stderr]\n${result.stderr}` : "", `\n[exit ${result.code}]`].join("\n").trim();
      setSshOutput(output);
      if (command.includes("nvidia-smi")) {
        const next = parseNvidiaSmi(result.stdout);
        setGpus(next);
        setRaw(result.stdout);
      }
      award(8);
      try {
        const text = await callMaaS(
          "gears",
          `用户通过 SSH 执行了命令：${command}\n输出：\n${output.slice(0, 6000)}\n请诊断服务器状态，指出风险和下一步建议，控制在 180 字内。`,
          { maxTokens: 800 },
        );
        setAdvice(text || "机械师：远程命令执行完成。");
      } catch {
        setAdvice("机械师：远程命令执行完成，MaaS 暂时没有返回诊断。");
      }
    } catch (error) {
      setSshOutput(error instanceof Error ? error.message : "SSH command failed");
    } finally {
      setSshRunning(false);
    }
  };
  return (
    <div className="page-grid">
      <section className="pixel-panel module-head orange">
        <div><p className="eyebrow">Server Agent</p><h1>机械师的控制室</h1><p>通过本地 SSH 代理连接服务器，执行安全巡检命令；也可以粘贴输出离线解析。</p></div>
        <WorkspaceScene view="server" outfit="work" busy={sshRunning || loadingAdvice} />
      </section>
      <section className="pixel-panel ssh-console">
        <h2>SSH 控制台</h2>
        <div className="ssh-grid">
          <input value={sshHost} onChange={(event) => setSshHost(event.target.value)} placeholder="Host / IP" />
          <input type="number" value={sshPort} onChange={(event) => setSshPort(Number(event.target.value))} placeholder="Port" />
          <input value={sshUser} onChange={(event) => setSshUser(event.target.value)} placeholder="User" />
          <input type="password" value={sshPassword} onChange={(event) => setSshPassword(event.target.value)} placeholder="Password" />
        </div>
        <div className="preset-row">
          {SSH_PRESETS.map((preset) => <button className="pixel-btn small secondary" onClick={() => { setSshCommand(preset.command); executeSsh(preset.command); }} disabled={sshRunning} key={preset.title}>{preset.title}</button>)}
        </div>
        <div className="input-row">
          <input value={sshCommand} onChange={(event) => setSshCommand(event.target.value)} placeholder="安全命令，例如 nvidia-smi / df -h / ps -u $USER" />
          <button className="pixel-btn" onClick={() => executeSsh()} disabled={sshRunning}>{sshRunning ? "执行中" : "执行"}</button>
        </div>
        <pre className="terminal-output">{sshOutput}</pre>
      </section>
      <section className="pixel-panel">
        <h2>粘贴解析 fallback</h2>
        <textarea value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="把 nvidia-smi 输出贴在这里..." />
        <div className="button-row">
          <button className="pixel-btn" onClick={parse}>解析状态</button>
          <button className="pixel-btn secondary" onClick={() => setRaw(SAMPLE_NVIDIA_SMI)}>填入示例</button>
        </div>
      </section>
      <section className="pixel-panel map-card">
        <h2>{loadingAdvice ? "机械师诊断中" : "机械师诊断"}</h2>
        <p>{advice}</p>
      </section>
      <section className="pixel-panel">
        <h2>运维命令卡</h2>
        <div className="command-grid">
          {OPS_COMMANDS.map((item) => <code key={item.title}><strong>{item.title}</strong>{item.command}</code>)}
        </div>
      </section>
      {history.length > 0 && <section className="pixel-panel">
        <h2>状态历史</h2>
        <div className="timeline">
          {history.map((item) => (
            <div className="timeline-item" key={item.at}>
              <strong>{item.at}</strong>
              <span>{item.count} GPUs</span>
              <span>{item.hot} hot</span>
              <span>mem {item.memory}%</span>
            </div>
          ))}
        </div>
      </section>}
      <section className="gpu-grid">
        {gpus.length === 0 ? <div className="empty pixel-panel">机械师：机器还没开灯，把输出贴给我看看。</div> : gpus.map((gpu) => (
          <div className="gpu-card pixel-panel" key={gpu.id}>
            <h3>GPU {gpu.id}</h3>
            <div className={`status-light ${gpu.temp > 85 ? "hot" : gpu.temp > 70 ? "warm" : "cool"}`} />
            <p>温度 {gpu.temp || "?"}°C</p>
            <div className="bar"><span style={{ width: `${gpu.util}%` }} /></div>
            <p>{gpu.used} / {gpu.total} MiB</p>
          </div>
        ))}
      </section>
    </div>
  );
}

function createLearningPath(topic: string): LearningPath {
  return {
    topic,
    stages: [
      { title: "新手村", place: "概念入口", focus: `用 30 分钟建立 ${topic} 的问题定义、术语和应用边界。`, done: false },
      { title: "概念森林", place: "前置知识", focus: "补齐数学、模型结构、训练流程和常见坑。", done: false },
      { title: "实践矿洞", place: "最小实验", focus: "跑一个最小可复现实验，记录输入、输出和失败日志。", done: false },
      { title: "进阶深渊", place: "论文阅读", focus: "读 3 篇核心论文，整理方法差异和实验设置。", done: false },
      { title: "大师殿堂", place: "产出", focus: "写一份技术笔记或复现实验报告，把知识固化。", done: false },
    ],
  };
}

function LearningPage({ state, dispatch, award }: { state: AppState; dispatch: React.Dispatch<Action>; award: (n: number) => void }) {
  const [topic, setTopic] = useState("LoRA 微调");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("输入主题，生成一条 RPG 式学习路径。");
  const [quizAnswer, setQuizAnswer] = useState("");
  const [coachReply, setCoachReply] = useState("完成一个阶段后，学者会给你下一步测验或复盘建议。");
  const [tutorial, setTutorial] = useState<Tutorial | null>(null);
  const [tutorialLoading, setTutorialLoading] = useState(false);
  const path = state.learningPath;
  const completedStages = path?.stages.filter((stage) => stage.done).length || 0;
  const generate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setStatus("学者正在向 MaaS 询问知识地图...");
    try {
      const text = await callMaaS(
        "scholar",
        `请为“${topic}”生成一条科研人学习路径。必须只返回 JSON，格式为：{"topic":"...","stages":[{"title":"新手村","place":"...","focus":"...","done":false}]}。stages 需要 5 个，focus 用中文且每项不超过 50 字。`,
        { maxTokens: 1200 },
      );
      const parsed = extractJsonObject<LearningPath>(text);
      if (parsed?.topic && Array.isArray(parsed.stages) && parsed.stages.length) {
        dispatch({ type: "learning", path: parsed });
        setStatus("MaaS 已生成学习地图。");
      } else {
        dispatch({ type: "learning", path: createLearningPath(topic) });
        setStatus("MaaS 返回格式不完整，先使用本地学习地图。");
      }
    } catch {
      dispatch({ type: "learning", path: createLearningPath(topic) });
      setStatus("MaaS 暂时不可用，先使用本地学习地图。");
    } finally {
      setLoading(false);
      award(20);
    }
  };
  const openTutorial = async (index: number) => {
    const stage = path?.stages[index];
    if (!stage || !path) return;
    setTutorial({ title: `${path.topic} - ${stage.title}`, stage: stage.title, content: "学者正在写教程..." });
    setTutorialLoading(true);
    try {
      const content = await callMaaS(
        "scholar",
        `请为学习主题“${path.topic}”的阶段“${stage.title} / ${stage.place}”写一篇完整中文教程。阶段目标：${stage.focus}

结构必须包含：
1. 学习目标
2. 核心概念
3. 关键公式或机制
4. 动手实践步骤
5. 常见坑
6. 自测题
7. 下一步资源建议

内容要实用、分节清晰，控制在 900-1400 字。`,
        { maxTokens: 2200 },
      );
      setTutorial({ title: `${path.topic} - ${stage.title}`, stage: stage.title, content: content || "教程生成失败，请稍后再试。" });
    } catch {
      setTutorial({
        title: `${path.topic} - ${stage.title}`,
        stage: stage.title,
        content: `## 学习目标\n\n理解 ${stage.focus}\n\n## 核心概念\n\n先用自己的话解释本阶段概念，再找一个最小案例验证它。\n\n## 动手实践\n\n1. 建一个独立实验目录。\n2. 写下输入、输出和评价指标。\n3. 跑通最小脚本。\n4. 记录失败日志。\n\n## 自测题\n\n- 这个阶段解决的核心问题是什么？\n- 如果实验失败，最先检查哪三个变量？`,
      });
    } finally {
      setTutorialLoading(false);
    }
  };
  const completeStage = async (index: number) => {
    dispatch({ type: "learningStage", index, done: true });
    award(20);
    const stage = path?.stages[index];
    if (!stage) return;
    try {
      const reply = await callMaaS(
        "scholar",
        `用户刚完成学习阶段：${stage.title} / ${stage.focus}。请给 2 道简短自测题和 1 个下一步实践建议。`,
        { maxTokens: 800 },
      );
      setCoachReply(reply);
    } catch {
      setCoachReply(`学者：${stage.title} 已点亮。下一步请用自己的话复述核心概念，再找一个最小实验验证它。`);
    }
  };
  return (
    <div className="page-grid learn-layout">
      <section className="pixel-panel module-head green">
        <div><p className="eyebrow">Learning Agent</p><h1>学者的魔法塔</h1><p>{status}</p></div>
        <WorkspaceScene view="learn" outfit={state.wardrobe.scholar} busy={loading} />
      </section>
      <section className="pixel-panel">
        <div className="input-row"><input value={topic} onChange={(event) => setTopic(event.target.value)} /><button className="pixel-btn" onClick={generate} disabled={loading}>{loading ? "生成中" : "生成路径"}</button></div>
      </section>
      {path && <section className="path-map pixel-panel">
        <h2>{path.topic} 冒险地图</h2>
        <div className="progress-strip"><span style={{ width: `${Math.round((completedStages / path.stages.length) * 100)}%` }} /></div>
        <div className="stages">
          {path.stages.map((stage, index) => (
            <div className={`stage ${stage.done ? "done" : ""}`} key={stage.title}>
              <div className="stage-node">{index + 1}</div>
              <h3>{stage.title}</h3>
              <strong>{stage.place}</strong>
              <p>{stage.focus}</p>
              <div className="stage-actions">
                <button className="pixel-btn small" onClick={() => openTutorial(index)}>进入教程</button>
                <button className="pixel-btn small secondary" onClick={() => completeStage(index)} disabled={stage.done}>{stage.done ? "已完成" : "完成阶段"}</button>
              </div>
            </div>
          ))}
        </div>
      </section>}
      <section className="pixel-panel">
        <h2>阶段测验</h2>
        <textarea value={quizAnswer} onChange={(event) => setQuizAnswer(event.target.value)} placeholder="写下你对当前阶段的理解，或贴一段实验日志让学者点评。" />
        <button className="pixel-btn" onClick={async () => {
          if (!quizAnswer.trim()) return;
          setCoachReply("学者正在批改...");
          try {
            const reply = await callMaaS("scholar", `请点评这段学习复盘，并指出一个最重要的改进点：\n${quizAnswer}`, { maxTokens: 900 });
            setCoachReply(reply);
          } catch {
            setCoachReply("学者：复盘收到。建议把概念、代码、实验现象三者对应起来写，效果会更扎实。");
          }
        }}>提交复盘</button>
        <p className="agent-advice">{coachReply}</p>
      </section>
      {tutorial && <div className="tutorial-overlay">
        <article className="tutorial-panel pixel-panel">
          <button className="close" onClick={() => setTutorial(null)}>×</button>
          <p className="eyebrow">{tutorial.stage}</p>
          <h1>{tutorial.title}</h1>
          {tutorialLoading && <p>学者正在整理章节...</p>}
          <div className="tutorial-content">
            {tutorial.content.split(/\n+/).map((line, index) => {
              if (/^(#{1,3}\s*)?\d+\.\s/.test(line) || /^##\s/.test(line)) return <h2 key={index}>{line.replace(/^#+\s*/, "")}</h2>;
              if (/^[-*]\s/.test(line)) return <p className="tutorial-bullet" key={index}>{line.replace(/^[-*]\s*/, "")}</p>;
              return <p key={index}>{line}</p>;
            })}
          </div>
        </article>
      </div>}
    </div>
  );
}

function LifePage({ state, dispatch, award }: { state: AppState; dispatch: React.Dispatch<Action>; award: (n: number) => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Todo["category"]>("research");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Todo["priority"]>("medium");
  const [note, setNote] = useState("");
  const [mood, setMood] = useState<Mood>("good");
  const [moodReply, setMoodReply] = useState("园丁会根据你的心情给一段简短回应。");
  const [moodLoading, setMoodLoading] = useState(false);
  const addTodo = () => {
    if (!title.trim()) return;
    dispatch({ type: "addTodo", todo: { id: crypto.randomUUID(), title, category, due, priority, done: false, createdAt: new Date().toISOString() } });
    dispatch({ type: "garden", item: { id: crypto.randomUUID(), type: priority === "high" ? "rare" : "flower", x: Math.floor(Math.random() * 90), grownAt: new Date().toISOString() } });
    setTitle("");
    setDue("");
    award(3);
  };
  const recordMood = async () => {
    dispatch({ type: "mood", mood, note });
    dispatch({ type: "garden", item: { id: crypto.randomUUID(), type: "butterfly", x: Math.floor(Math.random() * 90), grownAt: new Date().toISOString() } });
    award(10);
    setMoodLoading(true);
    try {
      const text = await callMaaS(
        "bloom",
        `用户今天心情是 ${moodGlyph(mood)}，记录：${note || "没有详细记录"}。请用 80 字以内中文回应，给一个温和但具体的科研生活建议。`,
        { maxTokens: 500 },
      );
      setMoodReply(text || "园丁：记录下来了。今天也给自己留一点喘气的空间。");
    } catch {
      setMoodReply("园丁：MaaS 暂时不在，但我先替你把心情种进花园。今天先做一件小事就好。");
    } finally {
      setMoodLoading(false);
      setNote("");
    }
  };
  return (
    <div className="page-grid life-layout">
      <section className="pixel-panel module-head pink">
        <div><p className="eyebrow">Life Agent</p><h1>园丁的温室花园</h1><p>任务会长成花，心情会让花园有天气。</p></div>
        <WorkspaceScene view="life" outfit={state.wardrobe.bloom} busy={moodLoading} />
      </section>
      <section className="pixel-panel">
        <h2>种下一颗 Todo</h2>
        <div className="input-row">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：整理 Related Work" />
          <select value={category} onChange={(event) => setCategory(event.target.value as Todo["category"])}>
            {Object.entries(CATEGORY_LABELS).map(([key, value]) => <option value={key} key={key}>{value}</option>)}
          </select>
          <select value={priority} onChange={(event) => setPriority(event.target.value as Todo["priority"])}>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
          <input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
          <button className="pixel-btn" onClick={addTodo}>添加</button>
        </div>
        <div className="todo-list">
          {state.todos.map((todo) => (
            <label className={`todo ${todo.done ? "done" : ""}`} key={todo.id}>
              <input type="checkbox" checked={todo.done} onChange={() => { dispatch({ type: "toggleTodo", id: todo.id }); if (!todo.done) award(5); }} />
              <span>{todo.done ? "✿" : "◆"}</span>
              {todo.title}
              <em>{CATEGORY_LABELS[todo.category]} · {todo.priority || "medium"}{todo.due ? ` · ${todo.due}` : ""}</em>
            </label>
          ))}
        </div>
      </section>
      <section className="pixel-panel">
        <h2>农场日历</h2>
        <div className="calendar-grid">
          {Array.from({ length: 7 }, (_, index) => {
            const day = new Date();
            day.setDate(day.getDate() + index);
            const iso = day.toISOString().slice(0, 10);
            const items = state.todos.filter((todo) => todo.due === iso);
            return <div className="day-tile" key={iso}><strong>{day.toLocaleDateString("zh-CN", { weekday: "short" })}</strong><span>{day.getDate()}</span><em>{items.length ? `${items.length} 件` : "空"}</em></div>;
          })}
        </div>
      </section>
      <section className="pixel-panel garden-panel">
        <h2>像素花园</h2>
        <div className="garden">
          {state.garden.map((item) => <span className={`plant ${item.type}`} style={{ left: `${item.x}%` }} key={item.id}>{plantGlyph(item.type)}</span>)}
        </div>
      </section>
      <section className="pixel-panel">
        <h2>今日心情</h2>
        <div className="mood-row">
          {(["sad", "low", "ok", "good", "great"] as Mood[]).map((item) => <button className={mood === item ? "selected" : ""} onClick={() => setMood(item)} key={item}>{moodGlyph(item)}</button>)}
        </div>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="今天科研天气怎么样？" />
        <button className="pixel-btn" onClick={recordMood} disabled={moodLoading}>{moodLoading ? "回应中" : "记录"}</button>
        <p className="agent-advice">{moodReply}</p>
        <div className="mood-history">
          {state.moods.slice(0, 14).map((item, index) => <span className={`mood-dot ${item.mood}`} title={`${item.date} ${item.note}`} key={`${item.date}-${index}`} />)}
        </div>
      </section>
    </div>
  );
}

function plantGlyph(type: GardenItem["type"]) {
  return { flower: "✿", tree: "♣", rare: "✺", butterfly: "⋈", pond: "≈" }[type];
}

function moodGlyph(mood: Mood) {
  return { sad: "T_T", low: "-_-", ok: "•_•", good: "^_^", great: "*_*" }[mood];
}

function WardrobePanel({ state, dispatch, onClose }: { state: AppState; dispatch: React.Dispatch<Action>; onClose: () => void }) {
  const [agent, setAgent] = useState<AgentKey>("hoot");
  const totalOutfits = (Object.keys(OUTFITS) as AgentKey[]).reduce((sum, key) => sum + OUTFITS[key].length, 0);
  const unlocked = (Object.keys(OUTFITS) as AgentKey[]).reduce((sum, key) => sum + OUTFITS[key].filter((outfit) => state.stars >= outfit.cost).length, 0);
  return (
    <div className="overlay">
      <section className="wardrobe pixel-panel">
        <button className="close" onClick={onClose}>×</button>
        <div className="wardrobe-preview">
          <PixelAgent agent={agent} outfit={state.wardrobe[agent]} size={6} />
          <div><p className="eyebrow">Wardrobe & Achievement</p><h2>{AGENTS[agent].title}的衣柜</h2><p>已解锁 {unlocked}/{totalOutfits} 套装。星星足够即可穿戴，状态只保存在本机 localStorage。</p></div>
        </div>
        <div className="agent-tabs">
          {(Object.keys(AGENTS) as AgentKey[]).map((key) => <button className={agent === key ? "active" : ""} onClick={() => setAgent(key)} key={key}>{AGENTS[key].title}</button>)}
        </div>
        <div className="outfit-grid">
          {OUTFITS[agent].map((outfit) => {
            const locked = state.stars < outfit.cost;
            return (
              <button className={state.wardrobe[agent] === outfit.key ? "equipped" : ""} disabled={locked} onClick={() => dispatch({ type: "wardrobe", agent, outfit: outfit.key })} key={outfit.key}>
                <span>{locked ? "LOCK" : "OK"}</span>
                <strong>{outfit.label}</strong>
                <em>{outfit.cost}★</em>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
