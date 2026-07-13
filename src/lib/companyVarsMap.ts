import type { ProposalData } from "@/components/proposal/ProposalDocument"

export const COMPANY_VARS_MAP: Record<string, keyof ProposalData> = {
  '投標公司': 'companyName',
  '公司名稱': 'companyName',
  '公司地址': 'companyAddress',
  '聯絡人': 'contactPerson',
  '聯絡電話': 'contactPhone',
  '電話': 'contactPhone',
  '投標日期': 'submissionDate',
}

/** 給 UI 顯示用：找出 key 對應的中文欄位說明 */
export function getAutoFillLabel(key: string): string | null {
  const field = COMPANY_VARS_MAP[key]
  if (!field) return null
  const labels: Record<string, string> = {
    companyName:    '投標公司名稱',
    companyAddress: '公司地址',
    contactPerson:  '聯絡人',
    contactPhone:   '聯絡電話',
    submissionDate: '投標日期',
  }
  return labels[field as string] ?? field as string
}
