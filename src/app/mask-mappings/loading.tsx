import { PageSkeleton } from "@/components/loading"

export default function Loading() {
  return <PageSkeleton withControl list="table" rows={6} />
}
