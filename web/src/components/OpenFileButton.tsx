import { useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { setUpload } from '../lib/uploadStore'

const ACCEPT = '.gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.mxl,.cap,.capx'

interface Props {
  className?: string
  children: ReactNode
}

export default function OpenFileButton({ className, children }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const data = new Uint8Array(await file.arrayBuffer())
    setUpload(file.name, data)
    e.target.value = ''
    navigate('/tab/_uploaded')
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={onChange}
      />
      <button className={className} onClick={() => inputRef.current?.click()}>
        {children}
      </button>
    </>
  )
}
