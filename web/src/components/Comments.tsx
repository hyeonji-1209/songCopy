import { useEffect, useState } from 'react'
import {
  deleteComment,
  fetchComments,
  formatRevDate,
  postComment,
  type CommentInfo,
} from '../lib/api'
import { useUser } from '../lib/auth'

interface Props {
  slug: string
}

export default function Comments({ slug }: Props) {
  const user = useUser()
  const [comments, setComments] = useState<CommentInfo[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchComments(slug)
      .then((c) => {
        if (!cancelled) setComments(c)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [slug, user?.email])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    setBusy(true)
    try {
      const c = await postComment(slug, t)
      setComments((prev) => [c, ...prev])
      setText('')
    } catch {
      alert('댓글 등록에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number) => {
    try {
      await deleteComment(id)
      setComments((prev) => prev.filter((c) => c.id !== id))
    } catch {
      /* 무시 */
    }
  }

  return (
    <section className="comments">
      <h2 className="comments-title">댓글 {comments.length > 0 && `(${comments.length})`}</h2>
      {user ? (
        <form className="comment-form" onSubmit={submit}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="채보 오류 제보, 연주 팁 등을 남겨보세요"
            rows={2}
            maxLength={2000}
          />
          <button className="auth-submit" type="submit" disabled={busy || !text.trim()}>
            등록
          </button>
        </form>
      ) : (
        <p className="comments-signin">댓글을 남기려면 로그인하세요.</p>
      )}
      <ul className="comment-list">
        {comments.map((c) => (
          <li key={c.id} className="comment">
            <div className="comment-head">
              <b>{c.author ?? '익명'}</b>
              <span className="comment-date">{formatRevDate(c.date)}</span>
              {c.mine && (
                <button className="comment-delete" onClick={() => remove(c.id)} title="삭제">
                  삭제
                </button>
              )}
            </div>
            <p className="comment-text">{c.text}</p>
          </li>
        ))}
        {comments.length === 0 && <li className="comments-empty">첫 댓글을 남겨보세요.</li>}
      </ul>
    </section>
  )
}
