import { PageSkeleton } from "@/components/loading"

export default function Loading() {
  return <PageSkeleton withControl stats={4} list="grid2" rows={4} />
}
