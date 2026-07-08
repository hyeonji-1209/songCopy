export interface SongDef {
  id: string
  slug: string
  title: string
  artist: string
  instruments: string[]
  revisionDate: string
  tex: string
}

// 모든 샘플 곡은 퍼블릭 도메인 곡의 자체 편곡(alphaTex)이다.
export const SONGS: SongDef[] = [
  {
    id: '1',
    slug: 'beethoven-ode-to-joy',
    title: 'Ode to Joy',
    artist: 'Ludwig van Beethoven',
    instruments: ['기타', '키보드', '베이스', '브라스', '드럼'],
    revisionDate: '2026. 7. 8.',
    tex: `\\title "Ode to Joy"
\\subtitle "Ludwig van Beethoven"
\\tempo 110
.
\\track "멜로디 기타"
\\staff {score tabs}
\\section 벌스
:4 0.1 0.1 1.1 3.1 |
3.1 1.1 0.1 3.2 |
1.2 1.2 3.2 0.1 |
:2 0.1 3.2 |
\\section "벌스 2"
:4 0.1 0.1 1.1 3.1 |
3.1 1.1 0.1 3.2 |
1.2 1.2 3.2 0.1 |
:2 3.2 1.2
\\track "키보드"
\\staff {score}
\\instrument 0
:2 (c4 e4 g4) (c4 e4 g4) |
(c4 e4 g4) (b3 d4 g4) |
(c4 e4 g4) (b3 d4 g4) |
(c4 e4 g4) (b3 d4 g4) |
(c4 e4 g4) (c4 e4 g4) |
(c4 e4 g4) (b3 d4 g4) |
(c4 e4 g4) (b3 d4 g4) |
(b3 d4 g4) (c4 e4 g4)
\\track "베이스"
\\staff {tabs}
\\instrument 33
\\tuning g2 d2 a1 e1
:2 3.3 3.4 |
3.4 3.4 |
3.3 3.4 |
3.4 3.3 |
3.3 3.4 |
3.4 3.4 |
3.3 3.4 |
3.4 3.3
\\track "브라스"
\\staff {score}
\\instrument 56
:1 e4 |
g4 |
g4 |
g4 |
e4 |
g4 |
g4 |
:2 d4 e4
\\track "드럼"
\\instrument percussion
\\articulation defaults
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed :4 SnareHit SnareHit |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:4 KickHit SnareHit :2 KickHit`,
  },
  {
    id: '2',
    slug: 'traditional-twinkle-twinkle-little-star',
    title: 'Twinkle Twinkle Little Star',
    artist: 'Traditional',
    instruments: ['기타', '키보드', '베이스', '브라스', '드럼'],
    revisionDate: '2026. 7. 8.',
    tex: `\\title "Twinkle Twinkle Little Star"
\\subtitle "Traditional"
\\tempo 100
.
\\track "어쿠스틱 기타"
\\staff {score tabs}
\\instrument 25
\\section 벌스
:4 1.2 1.2 3.1 3.1 |
5.1 5.1 :2 3.1 |
:4 1.1 1.1 0.1 0.1 |
3.2 3.2 :2 1.2 |
\\section 브리지
:4 3.1 3.1 1.1 1.1 |
0.1 0.1 :2 3.2 |
:4 3.1 3.1 1.1 1.1 |
0.1 0.1 :2 3.2 |
\\section 아웃트로
:4 1.2 1.2 3.1 3.1 |
5.1 5.1 :2 3.1 |
:4 1.1 1.1 0.1 0.1 |
3.2 3.2 :2 1.2
\\track "키보드"
\\staff {score}
\\instrument 0
:2 (c4 e4 g4) (c4 e4 g4) |
(c4 f4 a4) (c4 e4 g4) |
(c4 f4 a4) (c4 e4 g4) |
(b3 d4 g4) (c4 e4 g4) |
(c4 e4 g4) (c4 f4 a4) |
(c4 e4 g4) (b3 d4 g4) |
(c4 e4 g4) (c4 f4 a4) |
(c4 e4 g4) (b3 d4 g4) |
(c4 e4 g4) (c4 e4 g4) |
(c4 f4 a4) (c4 e4 g4) |
(c4 f4 a4) (c4 e4 g4) |
(b3 d4 g4) (c4 e4 g4)
\\track "베이스"
\\staff {tabs}
\\instrument 33
\\tuning g2 d2 a1 e1
:2 3.3 3.3 |
1.4 3.3 |
1.4 3.3 |
3.4 3.3 |
3.3 1.4 |
3.3 3.4 |
3.3 1.4 |
3.3 3.4 |
3.3 3.3 |
1.4 3.3 |
1.4 3.3 |
3.4 3.3
\\track "브라스"
\\staff {score}
\\instrument 56
:2 g4 g4 |
a4 g4 |
a4 g4 |
d4 e4 |
g4 a4 |
g4 d4 |
g4 a4 |
g4 d4 |
g4 g4 |
a4 g4 |
a4 g4 |
d4 e4
\\track "드럼"
\\instrument percussion
\\articulation defaults
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed :4 SnareHit SnareHit |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed :4 SnareHit SnareHit |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:4 KickHit SnareHit :2 KickHit`,
  },
  {
    id: '3',
    slug: 'pierpont-jingle-bells',
    title: 'Jingle Bells',
    artist: 'James Lord Pierpont',
    instruments: ['기타', '키보드', '베이스', '브라스', '드럼'],
    revisionDate: '2026. 7. 8.',
    tex: `\\title "Jingle Bells"
\\subtitle "James Lord Pierpont"
\\tempo 130
.
\\track "일렉트릭 기타"
\\staff {score tabs}
\\instrument 27
\\section 코러스
:4 0.1 0.1 :2 0.1 |
:4 0.1 0.1 :2 0.1 |
:4 0.1 3.1 1.2 3.2 |
:1 0.1 |
:4 1.1 1.1 1.1 1.1 |
:4 1.1 0.1 :2 0.1 |
:4 0.1 3.2 3.2 0.1 |
:2 3.2 3.1
\\track "키보드"
\\staff {score}
\\instrument 0
:2 (c4 e4 g4) (c4 e4 g4) |
(c4 e4 g4) (c4 e4 g4) |
(c4 e4 g4) (c4 e4 g4) |
(c4 e4 g4) (b3 d4 g4) |
(c4 f4 a4) (c4 f4 a4) |
(c4 e4 g4) (c4 e4 g4) |
(b3 d4 g4) (b3 d4 g4) |
(b3 d4 g4) (c4 e4 g4)
\\track "베이스"
\\staff {tabs}
\\instrument 33
\\tuning g2 d2 a1 e1
:2 3.3 3.3 |
3.3 3.3 |
3.3 3.3 |
3.3 3.4 |
1.4 1.4 |
3.3 3.3 |
3.4 3.4 |
3.4 3.3
\\track "브라스"
\\staff {score}
\\instrument 56
:2 g4 g4 |
g4 g4 |
g4 g4 |
g4 d4 |
a4 a4 |
g4 g4 |
d4 d4 |
d4 e4
\\track "드럼"
\\instrument percussion
\\articulation defaults
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed :4 SnareHit SnareHit |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:8 (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed (KickHit HiHatClosed) HiHatClosed (SnareHit HiHatClosed) HiHatClosed |
:4 KickHit SnareHit :2 KickHit`,
  },
]

export function findSong(slug: string): SongDef | undefined {
  return SONGS.find((s) => s.slug === slug)
}
