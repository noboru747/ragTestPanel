import { NextRequest, NextResponse } from "next/server"
import { mockGitRepo } from "@/lib/mock-data"

export const runtime = 'edge'

const templates: Record<string, (project: string, features: string[]) => string> = {
  meeting: (project, features) => `## 週例會議程 — ${project}

**日期**: ${new Date().toLocaleDateString("zh-TW")}
**主持人**: PM
**與會人員**: 開發團隊、QA、設計

---

### 議題

1. **上週進度回顧** (15 min)
   - 已完成功能確認
   - 阻塞項目說明

2. **本週重點功能** (20 min)
${features
  .slice(0, 3)
  .map((f, i) => `   ${i + 1}. ${f}`)
  .join("\n")}

3. **風險與問題討論** (10 min)

4. **下週工作分配** (10 min)

---

*由 AI 根據 Git 專案現況自動生成*`,

  feature: (project, features) => `## 功能說明書 — ${project}

**版本**: 1.0
**生成日期**: ${new Date().toLocaleDateString("zh-TW")}

---

### 現有功能清單

${features.map((f, i) => `#### ${i + 1}. ${f}\n功能已整合至主系統，詳細 API 規格請參閱 \`docs/api.md\`。\n`).join("\n")}

---

*由 AI 根據 Git Repo 掃描自動生成*`,

  deploy: (_project, _features) => `## 部署指引

**環境**: Production
**生成日期**: ${new Date().toLocaleDateString("zh-TW")}

---

### 前置需求

\`\`\`bash
node >= 18
npm >= 9
PostgreSQL >= 14
Ollama (本地模型服務)
\`\`\`

### 部署步驟

\`\`\`bash
# 1. Clone 專案
git clone <repo-url>
cd <project>

# 2. 安裝依賴
npm install

# 3. 設定環境變數
cp .env.example .env.local

# 4. 啟動服務
npm run build && npm start
\`\`\`

---

*由 AI 根據 DEPLOY.md 自動生成*`,
}

export async function POST(req: NextRequest) {
  const { type, projectName } = await req.json()
  await new Promise((r) => setTimeout(r, 1200))

  const generator = templates[type] ?? templates.meeting
  const content = generator(projectName ?? "專案名稱", mockGitRepo.features)

  return NextResponse.json({
    success: true,
    document: {
      title: `${type === "meeting" ? "週例會議程" : type === "feature" ? "功能說明書" : "部署指引"} — ${projectName ?? "專案"}`,
      content,
      generatedAt: new Date().toISOString(),
      type,
    },
  })
}
