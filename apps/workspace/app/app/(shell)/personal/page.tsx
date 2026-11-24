import { redirect } from 'next/navigation'
import { PERSONAL_CHAT_PATH } from '@/components/shell/rail-mode'

export default function PersonalPage(): never {
  redirect(PERSONAL_CHAT_PATH)
}
