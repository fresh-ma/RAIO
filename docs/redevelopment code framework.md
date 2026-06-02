# RAIO 重开发项目代码框架

版本：v0.1  
用途：根据 `docs/research all in one.md` 重新开发 RAIO，采用主流前后端分离结构。  
推荐栈：React + TypeScript + FastAPI + MySQL。

## 1. 总体架构

建议采用 monorepo，但前后端保持清晰边界：

```text
RAIO/
├── apps/
│   ├── web/                 # React 前端
│   └── api/                 # FastAPI 后端
├── packages/
│   └── shared/              # 前后端共享类型、OpenAPI 产物、常量
├── docs/                    # 需求、架构、接口文档
├── scripts/                 # 开发、部署、数据初始化脚本
├── docker-compose.yml       # MySQL + API + Web 本地编排
├── .env.example             # 根级环境变量示例
├── README.md
└── Makefile                 # 常用命令入口，可选
```

推荐原则：

- 前端只负责 UI、交互、状态展示。
- 后端负责鉴权、数据库、大模型代理、arXiv/News 外部接口聚合。
- API Key、数据库密码、SSH 密码等敏感信息不能进入前端。
- AI 生成内容和真实来源数据必须在接口层区分。

## 2. 前端代码框架

### 2.1 前端技术选型

```text
框架：React + TypeScript + Vite
路由：React Router
请求：TanStack Query + fetch/axios
表单：React Hook Form + Zod
状态：Zustand，仅存 UI 状态；服务端数据交给 TanStack Query
样式：Tailwind CSS + CSS variables，保留像素风主题
测试：Vitest + React Testing Library
端到端：Playwright
```

### 2.2 前端目录

```text
apps/web/
├── public/
│   └── assets/
│       ├── avatars/
│       ├── agents/
│       └── pixel/
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   ├── providers.tsx
│   │   └── routes.ts
│   ├── pages/
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx
│   │   │   └── RegisterPage.tsx
│   │   ├── home/
│   │   │   └── HomePage.tsx
│   │   ├── profile/
│   │   │   └── ProfilePage.tsx
│   │   ├── paper/
│   │   │   ├── PaperSearchPage.tsx
│   │   │   ├── PaperVaultPage.tsx
│   │   │   └── PaperNotePage.tsx
│   │   ├── news/
│   │   │   └── NewsPage.tsx
│   │   ├── learn/
│   │   │   ├── LearnHomePage.tsx
│   │   │   ├── LearningPathPage.tsx
│   │   │   ├── StageLessonPage.tsx
│   │   │   └── QuizResultPage.tsx
│   │   ├── life/
│   │   │   └── LifePage.tsx
│   │   ├── achievements/
│   │   │   └── AchievementsPage.tsx
│   │   └── server/
│   │       └── ServerAgentPage.tsx
│   ├── features/
│   │   ├── auth/
│   │   │   ├── api.ts
│   │   │   ├── hooks.ts
│   │   │   ├── schemas.ts
│   │   │   └── components/
│   │   ├── profile/
│   │   ├── paper/
│   │   ├── news/
│   │   ├── learn/
│   │   ├── life/
│   │   ├── achievements/
│   │   ├── wardrobe/
│   │   └── server-agent/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── HudBar.tsx
│   │   ├── pixel/
│   │   │   ├── PixelAgent.tsx
│   │   │   ├── PixelPanel.tsx
│   │   │   ├── PixelButton.tsx
│   │   │   └── DialogBox.tsx
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Input.tsx
│   │       ├── Modal.tsx
│   │       └── Toast.tsx
│   ├── lib/
│   │   ├── apiClient.ts
│   │   ├── authStorage.ts
│   │   ├── date.ts
│   │   └── download.ts
│   ├── stores/
│   │   ├── uiStore.ts
│   │   └── agentStore.ts
│   ├── styles/
│   │   ├── globals.css
│   │   ├── theme.css
│   │   └── pixel.css
│   ├── types/
│   │   └── api.ts
│   └── main.tsx
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tailwind.config.ts
```

### 2.3 前端路由

```text
/login
/register
/
/profile
/papers
/papers/vault
/papers/:paperId/notes
/news
/learn
/learn/:pathId
/learn/:pathId/stages/:stageId
/learn/:pathId/stages/:stageId/quiz/result
/life
/achievements
/server
```

### 2.4 前端分层规则

- `pages/`：页面组合，不写复杂业务逻辑。
- `features/`：按业务模块放 API、hooks、schema、局部组件。
- `components/ui/`：通用基础组件，不依赖业务。
- `components/pixel/`：像素风组件，负责视觉表达。
- `lib/`：通用工具。
- `stores/`：只放轻量 UI 状态，例如侧边栏、当前 Agent、弹窗。

示例：

```text
features/paper/
├── api.ts              # searchPapers, savePaper, deleteSavedPaper
├── hooks.ts            # usePaperSearch, useSavedPapers
├── schemas.ts          # Zod 表单校验
├── types.ts
└── components/
    ├── PaperCard.tsx
    ├── PaperSearchBox.tsx
    ├── PaperMapSummary.tsx
    └── PaperNoteEditor.tsx
```

## 3. 后端代码框架

### 3.1 后端技术选型

```text
框架：FastAPI
数据库：MySQL
ORM：SQLAlchemy 2.x
迁移：Alembic
数据校验：Pydantic
鉴权：JWT 或 Session Cookie，建议先用 HttpOnly Cookie
密码：passlib/bcrypt 或 argon2
任务调度：APScheduler 或 Celery，News 刷新可先用 APScheduler
HTTP 客户端：httpx
测试：pytest + httpx AsyncClient
```

### 3.2 后端目录

```text
apps/api/
├── app/
│   ├── main.py
│   ├── api/
│   │   ├── deps.py
│   │   └── v1/
│   │       ├── router.py
│   │       ├── auth.py
│   │       ├── profile.py
│   │       ├── papers.py
│   │       ├── news.py
│   │       ├── learn.py
│   │       ├── life.py
│   │       ├── achievements.py
│   │       ├── wardrobe.py
│   │       └── server_agent.py
│   ├── core/
│   │   ├── config.py
│   │   ├── security.py
│   │   ├── errors.py
│   │   └── logging.py
│   ├── db/
│   │   ├── base.py
│   │   ├── session.py
│   │   └── init_data.py
│   ├── models/
│   │   ├── user.py
│   │   ├── profile.py
│   │   ├── paper.py
│   │   ├── learning.py
│   │   ├── life.py
│   │   ├── achievement.py
│   │   └── wardrobe.py
│   ├── schemas/
│   │   ├── auth.py
│   │   ├── profile.py
│   │   ├── paper.py
│   │   ├── news.py
│   │   ├── learning.py
│   │   ├── life.py
│   │   ├── achievement.py
│   │   └── common.py
│   ├── repositories/
│   │   ├── users.py
│   │   ├── papers.py
│   │   ├── learning.py
│   │   ├── life.py
│   │   └── achievements.py
│   ├── services/
│   │   ├── auth_service.py
│   │   ├── profile_service.py
│   │   ├── paper_service.py
│   │   ├── news_service.py
│   │   ├── learning_service.py
│   │   ├── life_service.py
│   │   ├── achievement_service.py
│   │   ├── wardrobe_service.py
│   │   ├── llm/
│   │   │   ├── client.py
│   │   │   ├── prompts.py
│   │   │   └── guardrails.py
│   │   ├── external/
│   │   │   ├── arxiv_client.py
│   │   │   ├── news_client.py
│   │   │   └── ssh_runner.py
│   │   └── files/
│   │       ├── avatar_storage.py
│   │       └── markdown_export.py
│   ├── jobs/
│   │   └── refresh_news.py
│   └── tests/
│       ├── test_auth.py
│       ├── test_papers.py
│       ├── test_learn.py
│       └── test_life.py
├── alembic/
│   ├── versions/
│   └── env.py
├── pyproject.toml
├── alembic.ini
└── .env.example
```

### 3.3 后端分层规则

- `api/`：只处理 HTTP 入参、鉴权依赖、返回 schema。
- `schemas/`：Pydantic 输入输出模型。
- `models/`：SQLAlchemy 数据库模型。
- `repositories/`：数据库读写，不写业务判断。
- `services/`：业务逻辑、大模型调用、外部接口聚合。
- `external/`：arXiv、News、SSH 等外部能力封装。
- `jobs/`：定时任务。

请求流程：

```text
Router
  -> Service
  -> Repository / External Client / LLM Client
  -> Schema response
```

## 4. 数据库模型分组

### 4.1 用户域

```text
users
profiles
user_sessions 或 refresh_tokens
```

职责：

- 用户注册登录。
- 密码加密。
- 个人资料。
- 头像和工作地点。

### 4.2 Paper 域

```text
papers
user_papers
paper_notes
paper_search_logs
```

职责：

- arXiv 论文缓存。
- 用户收藏。
- Markdown 笔记。
- AI 批注。
- 搜索历史。

### 4.3 Learn 域

```text
learning_paths
learning_stages
quiz_questions
quiz_attempts
```

职责：

- 学习路径。
- 阶段教程。
- 选择题测验。
- 分数和解析。

### 4.4 Life 域

```text
todos
mood_logs
garden_items
calendar_events
```

职责：

- Todo。
- 心情记录。
- 花园成长。
- 周历事件。

### 4.5 Game 域

```text
achievements
user_achievements
star_transactions
wardrobe_items
user_wardrobe_items
agent_outfits
```

职责：

- 隐藏成就。
- 星星积分流水。
- 装扮解锁和穿戴。

## 5. API 模块设计

### 5.1 Auth

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

### 5.2 Profile

```text
GET  /api/v1/profile
PUT  /api/v1/profile
POST /api/v1/profile/avatar
```

### 5.3 Paper

```text
GET    /api/v1/papers/search?q=&limit=5
POST   /api/v1/papers/save
GET    /api/v1/papers/saved
DELETE /api/v1/papers/saved/{paper_id}
GET    /api/v1/papers/{paper_id}
GET    /api/v1/papers/{paper_id}/notes
PUT    /api/v1/papers/{paper_id}/notes
POST   /api/v1/papers/{paper_id}/notes/ai-comment
GET    /api/v1/papers/{paper_id}/notes/download
```

### 5.4 News

```text
GET  /api/v1/news
POST /api/v1/news/refresh
```

### 5.5 Learn

```text
POST /api/v1/learn/paths
GET  /api/v1/learn/paths
GET  /api/v1/learn/paths/{path_id}
GET  /api/v1/learn/stages/{stage_id}
POST /api/v1/learn/stages/{stage_id}/quiz
POST /api/v1/learn/stages/{stage_id}/complete
```

### 5.6 Life

```text
GET    /api/v1/todos
POST   /api/v1/todos
PATCH  /api/v1/todos/{todo_id}
DELETE /api/v1/todos/{todo_id}
POST   /api/v1/moods
GET    /api/v1/moods
GET    /api/v1/garden
POST   /api/v1/garden/water
```

### 5.7 Achievements & Wardrobe

```text
GET  /api/v1/achievements
GET  /api/v1/stars
GET  /api/v1/wardrobe
POST /api/v1/wardrobe/unlock
POST /api/v1/wardrobe/equip
```

### 5.8 Server Agent

```text
POST /api/v1/server/parse-nvidia-smi
POST /api/v1/server/ssh/run
```

注意：SSH 密码不入库，只能用于一次请求。

## 6. 示例骨架代码

### 6.1 FastAPI 入口

```python
# apps/api/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings

app = FastAPI(title="RAIO API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
```

### 6.2 API 路由聚合

```python
# apps/api/app/api/v1/router.py
from fastapi import APIRouter

from app.api.v1 import auth, profile, papers, news, learn, life, achievements, wardrobe, server_agent

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(profile.router, prefix="/profile", tags=["profile"])
api_router.include_router(papers.router, prefix="/papers", tags=["papers"])
api_router.include_router(news.router, prefix="/news", tags=["news"])
api_router.include_router(learn.router, prefix="/learn", tags=["learn"])
api_router.include_router(life.router, tags=["life"])
api_router.include_router(achievements.router, prefix="/achievements", tags=["achievements"])
api_router.include_router(wardrobe.router, prefix="/wardrobe", tags=["wardrobe"])
api_router.include_router(server_agent.router, prefix="/server", tags=["server"])
```

### 6.3 配置

```python
# apps/api/app/core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_env: str = "local"
    database_url: str
    secret_key: str
    cors_origins: list[str] = ["http://localhost:5173"]

    llm_api_url: str
    llm_api_key: str
    llm_model: str = "deepseek-v4-flash"

    news_refresh_hours: int = 8


settings = Settings()
```

### 6.4 前端 API Client

```ts
// apps/web/src/lib/apiClient.ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

export async function apiClient<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail ?? error.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}
```

### 6.5 Paper Feature 示例

```ts
// apps/web/src/features/paper/api.ts
import { apiClient } from "@/lib/apiClient";

export type Paper = {
  id: string;
  arxivId: string;
  title: string;
  authors: string[];
  summary: string;
  publishedAt: string;
  url: string;
  relevanceScore?: number;
};

export function searchPapers(query: string, limit = 5) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return apiClient<{ papers: Paper[]; mapSummary: string }>(`/papers/search?${params}`);
}

export function savePaper(paperId: string) {
  return apiClient(`/papers/save`, {
    method: "POST",
    body: JSON.stringify({ paperId }),
  });
}
```

## 7. 环境变量

根目录 `.env.example`：

```text
APP_ENV=local

MYSQL_DATABASE=raio
MYSQL_USER=raio
MYSQL_PASSWORD=raio_password
MYSQL_ROOT_PASSWORD=root_password

DATABASE_URL=mysql+pymysql://raio:raio_password@localhost:3306/raio
SECRET_KEY=change-me

LLM_API_URL=https://api.modelarts-maas.com/v2/chat/completions
LLM_API_KEY=
LLM_MODEL=deepseek-v4-flash

NEWS_REFRESH_HOURS=8
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

## 8. Docker 本地开发

```yaml
# docker-compose.yml
services:
  mysql:
    image: mysql:8.4
    ports:
      - "3306:3306"
    env_file:
      - .env
    volumes:
      - mysql_data:/var/lib/mysql

  api:
    build:
      context: ./apps/api
    ports:
      - "8000:8000"
    env_file:
      - .env
    depends_on:
      - mysql

  web:
    build:
      context: ./apps/web
    ports:
      - "5173:5173"
    env_file:
      - .env
    depends_on:
      - api

volumes:
  mysql_data:
```

## 9. 推荐开发顺序

第一阶段：基础工程

- 搭建 `apps/web` 和 `apps/api`。
- 配置 Docker MySQL。
- 实现健康检查、CORS、环境变量。
- 建立用户表、Alembic 迁移。

第二阶段：用户系统

- 注册、登录、登出、当前用户。
- 密码加密。
- 个人信息页。
- 前端路由保护。

第三阶段：Paper 闭环

- arXiv 搜索。
- 收藏、删除、详情。
- Markdown 笔记。
- 笔记下载。
- AI 文献地图，但严格区分真实数据和模型总结。

第四阶段：Learn 闭环

- 学习路径生成。
- 阶段教程。
- 4 道选择题测验。
- 结果页和历史记录。

第五阶段：Life 与游戏化

- Todo 增删改查。
- 心情记录。
- 花园成长。
- 隐藏成就。
- 星星积分和换装。

第六阶段：News 与 Server Agent

- News 聚合和 8 小时缓存。
- 学术新闻优先。
- Server Agent 作为增强模块接入。

## 10. 最小可运行骨架

重开发时，建议第一版只追求这个最小骨架：

```text
apps/web:
  - 登录页
  - 首页 Layout
  - Paper 搜索页
  - Life Todo 页

apps/api:
  - /health
  - /auth/register
  - /auth/login
  - /auth/me
  - /papers/search
  - /todos

database:
  - users
  - profiles
  - papers
  - user_papers
  - todos
```

这个骨架跑通后，再逐步补 Learn、News、成就和换装。这样项目结构不会散，也不会一开始就陷入“大而全”的实现压力。
