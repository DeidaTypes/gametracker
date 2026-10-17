import { showToast } from '../../components/Toast'
import { shareContent } from '../../utils/share'

export function qaQuestionUrl(id) {
  return `checkpoint://qa/q/${id}`
}

export async function shareQaQuestion(question) {
  if (!question?.id) return
  const result = await shareContent({
    title: question.title || 'Question',
    url: qaQuestionUrl(question.id),
    dialogTitle: 'Share',
  })
  if (result?.method === 'clipboard') showToast('Link copied', 'success')
  else if (result?.method === 'failed') showToast("Couldn't share that.", 'error')
}

export async function copyQaLink(id) {
  if (!id) return
  try {
    await navigator.clipboard.writeText(qaQuestionUrl(id))
    showToast('Link copied', 'success')
  } catch {
    showToast("Couldn't copy that link.", 'error')
  }
}
