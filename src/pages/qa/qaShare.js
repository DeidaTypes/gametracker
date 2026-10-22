import { showToast } from '../../components/Toast'
import { SHARE_LINKS_ENABLED, siteLink } from '../../config/site'
import { shareContent } from '../../utils/share'

/**
 * Public link to a question: https://<site>/q/<id>. '' when the site is not
 * configured — callers share the question text without a link, and hide
 * "Copy link" (see QA_LINKS_AVAILABLE).
 */
export function qaQuestionUrl(id, title) {
  return siteLink('question', id, { title })
}

/** Whether "Copy link" can do anything. False until VITE_SITE_URL is set. */
export const QA_LINKS_AVAILABLE = SHARE_LINKS_ENABLED

export async function shareQaQuestion(question) {
  if (!question?.id) return
  const title = question.title || 'Question'
  const result = await shareContent({
    title,
    text: title,
    url: qaQuestionUrl(question.id, question.title),
    dialogTitle: 'Share',
  })
  if (result?.method === 'clipboard') {
    showToast(result.copied === 'link' ? 'Link copied' : 'Copied', 'success')
  } else if (result?.method === 'failed') {
    showToast("Couldn't share that.", 'error')
  }
}

export async function copyQaLink(id, title) {
  const url = qaQuestionUrl(id, title)
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    showToast('Link copied', 'success')
  } catch {
    showToast("Couldn't copy that link.", 'error')
  }
}
