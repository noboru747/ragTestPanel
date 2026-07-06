export type FieldType = "text" | "textarea" | "number" | "date" | "select" | "image" | "file" | "project_select"

export type TemplateField = {
  key: string
  label: string
  type: FieldType
  placeholder?: string
  required: boolean
  options?: string[]
}

export type DocumentTemplate = {
  id: string
  name: string
  category: string
  description: string
  fields: TemplateField[]
  tags: string[]
  ragEnabled?: boolean        // 是否使用 RAG 知識庫生成
  apiPath?: string            // 自訂 API 端點
}

export const mockTemplates: DocumentTemplate[] = [
  {
    id: "tmpl-rag-001",
    name: "勞務採購案投標建議書",
    category: "採購",
    description: "依據知識庫過往案件資料，由 AI 自動生成政府機關資訊勞務採購案投標建議書",
    tags: ["採購", "建議書", "AI生成", "RAG"],
    ragEnabled: true,
    apiPath: "/api/generate/proposal",
    fields: [
      { key: "_project_id",      label: "參考知識庫（專案）", type: "project_select", required: true },
      { key: "tender_name",      label: "標案名稱",           type: "text",     placeholder: "例：114年度資訊軟硬體駐點人員勞務採購案", required: true },
      { key: "agency_name",      label: "招標機關",           type: "text",     placeholder: "例：臺灣士林地方法院",              required: true },
      { key: "service_type",     label: "服務類型",           type: "select",   options: ["駐點人員服務", "系統開發維護", "資訊設備採購", "網路建置維護", "資安服務"], required: true },
      { key: "company_name",     label: "投標廠商名稱",       type: "text",     placeholder: "例：弘捷資訊服務有限公司",           required: true },
      { key: "bid_amount",       label: "投標金額（元）",     type: "number",   placeholder: "例：250000",                         required: true },
      { key: "service_period",   label: "服務期間",           type: "text",     placeholder: "例：114年1月1日至114年12月31日",      required: true },
      { key: "person_count",     label: "派駐人數",           type: "number",   placeholder: "例：1",                              required: false },
      { key: "extra_requirements", label: "特殊需求補充",     type: "textarea", placeholder: "補充技術需求、人員資格或其他說明...", required: false },
    ],
  },
  {
    id: "tmpl-001",
    name: "得標前經費建議書",
    category: "採購",
    description: "投標前提交給機關單位的經費規劃與開發建議文件",
    tags: ["採購", "公文", "經費"],
    fields: [
      { key: "agency_name", label: "開標單位", type: "text", placeholder: "例：台北市政府資訊局", required: true },
      { key: "agency_address", label: "開標地址", type: "text", placeholder: "例：台北市信義區市府路1號", required: true },
      { key: "project_name", label: "標案名稱", type: "text", placeholder: "標案全名", required: true },
      { key: "bid_amount", label: "建議經費（元）", type: "number", placeholder: "例：1500000", required: true },
      { key: "dev_proposal", label: "開發建議", type: "textarea", placeholder: "說明技術方案、執行策略與優勢...", required: true },
      { key: "deadline", label: "預計完工日期", type: "date", required: true },
      { key: "company_logo", label: "公司 Logo", type: "image", required: false },
      { key: "attachments", label: "附件文件", type: "file", required: false },
    ],
  },
  {
    id: "tmpl-002",
    name: "週例會議記錄",
    category: "會議",
    description: "每週例行會議的正式會議記錄文件",
    tags: ["會議", "週報"],
    fields: [
      { key: "meeting_date", label: "會議日期", type: "date", required: true },
      { key: "meeting_location", label: "會議地點", type: "text", placeholder: "例：A棟3樓會議室", required: true },
      { key: "host", label: "主持人", type: "text", placeholder: "姓名", required: true },
      { key: "attendees", label: "出席人員", type: "textarea", placeholder: "每行一人", required: true },
      { key: "agenda", label: "討論議題", type: "textarea", placeholder: "每行一個議題", required: true },
      { key: "resolutions", label: "決議事項", type: "textarea", placeholder: "每行一項決議", required: false },
      { key: "next_meeting", label: "下次會議時間", type: "date", required: false },
    ],
  },
  {
    id: "tmpl-003",
    name: "專案進度報告",
    category: "報告",
    description: "定期向業主或主管呈報的專案進度摘要",
    tags: ["報告", "進度"],
    fields: [
      { key: "project_name", label: "專案名稱", type: "text", required: true },
      { key: "report_period", label: "報告期間", type: "text", placeholder: "例：2026年6月", required: true },
      { key: "pm_name", label: "專案經理", type: "text", required: true },
      { key: "overall_progress", label: "整體完成度（%）", type: "number", placeholder: "0~100", required: true },
      { key: "completed_items", label: "本期完成項目", type: "textarea", placeholder: "每行一項", required: true },
      { key: "in_progress", label: "進行中項目", type: "textarea", placeholder: "每行一項", required: true },
      { key: "risks", label: "風險與問題", type: "textarea", placeholder: "說明當前風險...", required: false },
      { key: "next_plan", label: "下期計畫", type: "textarea", placeholder: "每行一項", required: false },
      { key: "cover_image", label: "封面圖片", type: "image", required: false },
    ],
  },
  {
    id: "tmpl-004",
    name: "功能需求規格書",
    category: "技術",
    description: "系統或功能模組的需求定義文件",
    tags: ["需求", "技術", "規格"],
    fields: [
      { key: "system_name", label: "系統 / 模組名稱", type: "text", required: true },
      { key: "version", label: "文件版本", type: "text", placeholder: "例：v1.0", required: true },
      { key: "author", label: "撰寫人", type: "text", required: true },
      { key: "overview", label: "功能概述", type: "textarea", placeholder: "簡述此功能的目的與範圍", required: true },
      { key: "user_stories", label: "使用者故事", type: "textarea", placeholder: "As a [角色], I want [功能], So that [目的]...", required: true },
      { key: "acceptance", label: "驗收標準", type: "textarea", placeholder: "每行一個驗收條件", required: true },
      { key: "wireframe", label: "線框圖 / 截圖", type: "image", required: false },
    ],
  },
  {
    id: "tmpl-005",
    name: "正式函文",
    category: "公文",
    description: "機關往來的正式公文函",
    tags: ["公文", "正式"],
    fields: [
      { key: "sender_org", label: "發文機關", type: "text", required: true },
      { key: "sender_address", label: "發文地址", type: "text", required: true },
      { key: "receiver_org", label: "收文機關", type: "text", required: true },
      { key: "subject", label: "主旨", type: "text", placeholder: "簡述函文主旨", required: true },
      { key: "body", label: "說明", type: "textarea", placeholder: "詳細說明事項...", required: true },
      { key: "doc_date", label: "發文日期", type: "date", required: true },
      { key: "doc_number", label: "文號", type: "text", placeholder: "例：北市資字第1234567890號", required: false },
      { key: "attachment_list", label: "附件清單", type: "textarea", placeholder: "每行一項附件", required: false },
      { key: "official_seal", label: "機關印章", type: "image", required: false },
    ],
  },
]

export const templateCategories = [...new Set(mockTemplates.map((t) => t.category))]
