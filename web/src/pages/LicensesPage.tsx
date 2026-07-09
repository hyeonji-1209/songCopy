// 오픈소스 고지 — 상업 서비스 요건 (MPL-2.0/Apache-2.0/CC BY/OFL 고지 의무 이행)
const ITEMS: Array<[name: string, license: string, holder: string, url: string]> = [
  ['alphaTab', 'MPL-2.0', 'CoderLine', 'https://github.com/CoderLine/alphaTab'],
  ['Sonivox EAS 사운드폰트', 'Apache-2.0', 'Sonic Network Inc.', 'https://github.com/CoderLine/alphaTab'],
  ['Bravura 악보 폰트', 'SIL OFL 1.1', 'Steinberg Media Technologies', 'https://github.com/steinbergmedia/bravura'],
  ['YourMT3+ (채보 모델 가중치)', 'Apache-2.0', 'Sungkyun Chang (mimbres)', 'https://github.com/mimbres/YourMT3'],
  ['mt3-infer', 'MIT', 'OpenMIR Lab', 'https://github.com/openmirlab/mt3-infer'],
  ['Transkun (피아노 채보)', 'MIT', 'Yujia Yan', 'https://github.com/Yujia-Yan/Transkun'],
  ['Whisper (가사 인식 모델)', 'MIT', 'OpenAI', 'https://github.com/openai/whisper'],
  ['faster-whisper', 'MIT', 'SYSTRAN', 'https://github.com/SYSTRAN/faster-whisper'],
  ['basic-pitch', 'Apache-2.0', 'Spotify', 'https://github.com/spotify/basic-pitch'],
  [
    'PANNs Cnn14 (음색 판별 모델)',
    'CC BY 4.0 — Kong, Qiuqiang, et al. "PANNs: Large-Scale Pretrained Audio Neural Networks for Audio Pattern Recognition." (2020)',
    'Qiuqiang Kong et al.',
    'https://zenodo.org/records/3987831',
  ],
  ['python-audio-separator', 'MIT', 'Nomad Karaoke', 'https://github.com/nomadkaraoke/python-audio-separator'],
  ['librosa', 'ISC', 'librosa development team', 'https://github.com/librosa/librosa'],
  ['React / Vite', 'MIT', 'Meta / VoidZero', 'https://react.dev'],
]

export default function LicensesPage() {
  return (
    <div className="licenses-page">
      <h1>오픈소스 라이선스</h1>
      <p className="licenses-note">
        songCopy는 아래 오픈소스 소프트웨어와 모델 위에서 만들어졌습니다. 각 항목은 해당
        라이선스 조건에 따라 사용됩니다. 음원 분리는 MVSep API를 통해 처리됩니다.
      </p>
      <table className="licenses-table">
        <thead>
          <tr>
            <th>구성요소</th>
            <th>라이선스</th>
            <th>저작권자</th>
          </tr>
        </thead>
        <tbody>
          {ITEMS.map(([name, license, holder, url]) => (
            <tr key={name}>
              <td>
                <a href={url} target="_blank" rel="noreferrer">
                  {name}
                </a>
              </td>
              <td>{license}</td>
              <td>{holder}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
