export const mockProjects = [
  {
    id: "proj-001",
    name: "ERP 系統升級",
    description: "企業資源規劃系統 v2.0 升級專案",
    status: "active",
    docCount: 24,
    lastUpdated: "2026-06-28",
    tags: ["ERP", "後端", "資料庫"],
    gitRepo: "https://github.com/org/erp-v2",
    gitConnected: true,
  },
  {
    id: "proj-002",
    name: "客戶入口網站",
    description: "B2B 客戶自助服務平台重構",
    status: "active",
    docCount: 18,
    lastUpdated: "2026-06-27",
    tags: ["React", "前端", "API"],
    gitRepo: null,
    gitConnected: false,
  },
  {
    id: "proj-003",
    name: "數據分析儀表板",
    description: "即時業務數據視覺化系統",
    status: "review",
    docCount: 31,
    lastUpdated: "2026-06-25",
    tags: ["Python", "BI", "資料視覺化"],
    gitRepo: "https://github.com/org/dashboard",
    gitConnected: true,
  },
  {
    id: "proj-004",
    name: "行動 App 2.0",
    description: "iOS / Android 跨平台行動應用",
    status: "planning",
    docCount: 9,
    lastUpdated: "2026-06-20",
    tags: ["React Native", "行動端"],
    gitRepo: null,
    gitConnected: false,
  },
]

export const mockDocuments: Record<string, MockDocument[]> = {
  "proj-001": [
    {
      id: "doc-001",
      name: "專案章程 v1.2.pdf",
      type: "pdf",
      size: "2.4 MB",
      uploadedAt: "2026-06-10",
      status: "indexed",
      tags: ["章程", "範圍"],
      summary: "定義 ERP 升級專案的範圍、目標、關鍵里程碑與利害關係人。",
    },
    {
      id: "doc-002",
      name: "系統架構設計.docx",
      type: "word",
      size: "1.8 MB",
      uploadedAt: "2026-06-12",
      status: "indexed",
      tags: ["架構", "技術"],
      summary: "詳述新版 ERP 系統的微服務架構、資料庫設計與 API 規格。",
    },
    {
      id: "doc-003",
      name: "Q2 進度報告.pptx",
      type: "ppt",
      size: "5.1 MB",
      uploadedAt: "2026-06-20",
      status: "indexed",
      tags: ["進度", "報告"],
      summary: "第二季度專案進度摘要，涵蓋完成項目、風險與下季計畫。",
    },
    {
      id: "doc-004",
      name: "預算規劃表.xlsx",
      type: "excel",
      size: "0.9 MB",
      uploadedAt: "2026-06-15",
      status: "indexed",
      tags: ["預算", "財務"],
      summary: "專案預算分配、實際支出與預測，含人力與基礎設施成本。",
    },
    {
      id: "doc-005",
      name: "系統截圖_登入頁.png",
      type: "image",
      size: "0.3 MB",
      uploadedAt: "2026-06-22",
      status: "indexed",
      tags: ["UI", "截圖"],
      summary: "新版登入頁面設計稿，含權限角色切換功能展示。",
    },
  ],
  "proj-002": [
    {
      id: "doc-006",
      name: "需求規格書 v3.pdf",
      type: "pdf",
      size: "3.2 MB",
      uploadedAt: "2026-06-05",
      status: "indexed",
      tags: ["需求", "規格"],
      summary: "客戶入口網站功能需求，包含自助下單、查詢與報表模組。",
    },
    {
      id: "doc-007",
      name: "UI 設計稿.pdf",
      type: "pdf",
      size: "8.7 MB",
      uploadedAt: "2026-06-18",
      status: "indexed",
      tags: ["設計", "UI/UX"],
      summary: "Figma 匯出的完整 UI 設計，含元件庫與互動說明。",
    },
  ],
  "proj-003": [
    {
      id: "doc-008",
      name: "數據來源規格.docx",
      type: "word",
      size: "1.1 MB",
      uploadedAt: "2026-06-08",
      status: "indexed",
      tags: ["資料", "規格"],
      summary: "儀表板各數據來源的欄位定義、更新頻率與 API 串接方式。",
    },
  ],
}

export const mockQueryHistory: MockQueryMessage[] = [
  {
    id: "msg-001",
    role: "user",
    content: "ERP 升級專案目前的主要風險有哪些？",
    timestamp: "2026-06-28T10:30:00",
  },
  {
    id: "msg-002",
    role: "assistant",
    content:
      "根據 Q2 進度報告與系統架構設計文件，目前識別的主要風險如下：\n\n**1. 資料移轉風險（高）**\n舊系統有 15 年歷史數據，格式不統一，預計移轉驗證需額外 3 週。\n\n**2. 第三方 API 整合（中）**\n財務模組依賴供應商 API，目前文件版本落差，等待對方更新。\n\n**3. 使用者培訓時程（中）**\n原預計 Q3 末上線，培訓計畫尚未確認場地與講師資源。",
    timestamp: "2026-06-28T10:30:15",
    sources: [
      { docId: "doc-003", docName: "Q2 進度報告.pptx", relevance: 0.94 },
      { docId: "doc-002", docName: "系統架構設計.docx", relevance: 0.81 },
    ],
  },
]

export const mockGitRepo = {
  url: "https://github.com/org/erp-v2",
  branch: "main",
  lastPulled: "2026-06-28T08:00:00",
  status: "synced",
  structure: [
    { path: "README.md", type: "file" },
    { path: "DEPLOY.md", type: "file" },
    { path: "FEATURES.md", type: "file" },
    { path: "src/", type: "dir" },
    { path: "src/components/", type: "dir" },
    { path: "src/pages/", type: "dir" },
    { path: "docs/", type: "dir" },
    { path: "docs/api.md", type: "file" },
    { path: "docs/architecture.md", type: "file" },
  ],
  features: [
    "使用者認證與 RBAC 權限管理",
    "採購管理模組（PO 建立、審核、追蹤）",
    "庫存管理（即時庫存、盤點、調撥）",
    "財務報表產生器",
    "多語系支援（繁中、英文）",
    "REST API + GraphQL 雙介面",
  ],
}

export const mockGeneratedDocs = [
  {
    id: "gen-001",
    title: "週例會議程 - ERP 升級 (2026-06-30)",
    type: "meeting",
    generatedAt: "2026-06-28T14:00:00",
    preview:
      "## 週例會議程\n\n**日期**: 2026-06-30 10:00\n**主持人**: PM\n\n### 議題\n1. Q2 進度確認（15 min）\n2. 資料移轉風險討論（20 min）\n3. 下週工作分配（10 min）",
  },
  {
    id: "gen-002",
    title: "功能說明書 - 採購管理模組",
    type: "feature-doc",
    generatedAt: "2026-06-27T16:30:00",
    preview:
      "## 採購管理模組\n\n### 功能概述\n本模組提供完整的採購流程管理，從 PR 申請到 PO 核發一站式處理。\n\n### 主要功能\n- 採購申請（PR）建立與審核\n- 供應商管理",
  },
]

export const mockStats = {
  totalProjects: 4,
  totalDocuments: 82,
  indexedDocuments: 78,
  totalQueries: 156,
  lastActivity: "2026-06-28",
}

export const mockOcrQueue: {
  id: string
  filename: string
  status: "queued" | "processing" | "completed" | "error"
  progress: number
  model: string
  extractedChars: number | null
}[] = [
  {
    id: "ocr-001",
    filename: "合約_廠商A.pdf",
    status: "completed",
    progress: 100,
    model: "qwen2.5vl:7b",
    extractedChars: 4821,
  },
  {
    id: "ocr-002",
    filename: "會議紀錄_0625.jpg",
    status: "processing",
    progress: 63,
    model: "qwen2.5vl:7b",
    extractedChars: null,
  },
  {
    id: "ocr-003",
    filename: "規格書_v4.docx",
    status: "queued",
    progress: 0,
    model: "qwen2.5vl:7b",
    extractedChars: null,
  },
]

export type MockProject = (typeof mockProjects)[0]
export type MockDocument = {
  id: string
  name: string
  type: "pdf" | "word" | "excel" | "ppt" | "image"
  size: string
  uploadedAt: string
  status: "indexed" | "processing" | "queued" | "error"
  tags: string[]
  summary: string
}
export type MockQueryMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: string
  sources?: { docId: string; docName: string; relevance: number }[]
}
