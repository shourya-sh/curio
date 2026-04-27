/**
 * Decorative circles using the same solid fills as workspace canvas nodes
 * (.mf-node.root and .mf-node.orb orb-1 … orb-4 in index.css).
 */
type NodeSpec = {
  top?: string
  left?: string
  right?: string
  bottom?: string
  width: number
  height: number
  /** Matches workspace palette: root + four satellite orbs */
  variant: 'root' | 'orb1' | 'orb2' | 'orb3' | 'orb4'
  /** Different wander paths / timing */
  motion?: 'a' | 'b' | 'c' | 'd'
  delay?: string
  duration?: string
}

const NODES: NodeSpec[] = [
  { top: '2%', left: '3%', width: 168, height: 168, variant: 'root', motion: 'a' },
  { top: '0%', right: '5%', width: 220, height: 220, variant: 'orb1', motion: 'b', delay: '0.6s' },
  { top: '11%', left: '38%', width: 88, height: 88, variant: 'orb2', motion: 'c' },
  { top: '18%', right: '26%', width: 72, height: 72, variant: 'orb3', motion: 'a', delay: '1.1s' },
  { top: '7%', left: '22%', width: 48, height: 48, variant: 'orb4', motion: 'b' },
  { top: '24%', right: '6%', width: 104, height: 104, variant: 'orb2', motion: 'c', delay: '0.3s' },
  { top: '34%', left: '1%', width: 196, height: 196, variant: 'orb1', motion: 'b' },
  { top: '32%', left: '48%', width: 76, height: 76, variant: 'root', motion: 'a', delay: '1.4s' },
  { top: '44%', right: '10%', width: 140, height: 140, variant: 'orb4', motion: 'c' },
  { top: '48%', left: '14%', width: 96, height: 96, variant: 'orb3', motion: 'b' },
  { top: '58%', right: '20%', width: 118, height: 118, variant: 'root', motion: 'a', delay: '0.8s' },
  { top: '54%', left: '5%', width: 64, height: 64, variant: 'orb1', motion: 'c' },
  { top: '68%', left: '32%', width: 184, height: 184, variant: 'orb2', motion: 'b', duration: '14s' },
  { top: '64%', right: '3%', width: 88, height: 88, variant: 'orb4', motion: 'a' },
  { top: '74%', left: '9%', width: 124, height: 124, variant: 'orb3', motion: 'c', delay: '0.5s' },
  { top: '80%', right: '34%', width: 156, height: 156, variant: 'orb1', motion: 'b' },
  { top: '86%', left: '54%', width: 80, height: 80, variant: 'orb2', motion: 'a', delay: '1.2s' },
  { top: '9%', left: '58%', width: 40, height: 40, variant: 'orb4', motion: 'c', delay: '1.8s' },
  { top: '26%', left: '7%', width: 58, height: 58, variant: 'root', motion: 'b' },
  { top: '40%', right: '1%', width: 52, height: 52, variant: 'orb2', motion: 'a', delay: '0.4s' },
  { top: '90%', right: '7%', width: 112, height: 112, variant: 'orb3', motion: 'c' },
  { top: '5%', right: '40%', width: 36, height: 36, variant: 'orb3', motion: 'b' },
  { top: '52%', right: '40%', width: 84, height: 84, variant: 'orb4', motion: 'a' },
  { bottom: '5%', left: '68%', width: 132, height: 132, variant: 'root', motion: 'c', delay: '0.9s' },
  { top: '15%', right: '14%', width: 56, height: 56, variant: 'orb4', motion: 'a' },
  { top: '61%', left: '28%', width: 44, height: 44, variant: 'orb1', motion: 'b' },
  { top: '42%', left: '72%', width: 68, height: 68, variant: 'orb2', motion: 'c' },
  { top: '78%', right: '18%', width: 52, height: 52, variant: 'root', motion: 'b', delay: '2s' },
  { top: '33%', right: '35%', width: 92, height: 92, variant: 'orb3', motion: 'a' },
  { top: '12%', left: '14%', width: 76, height: 76, variant: 'orb4', motion: 'c' },
  { top: '50%', left: '62%', width: 100, height: 100, variant: 'orb1', motion: 'b', delay: '1.6s' },
  { top: '92%', left: '22%', width: 60, height: 60, variant: 'orb2', motion: 'a' },
  { top: '63%', right: '48%', width: 38, height: 38, variant: 'orb3', motion: 'b' },
  { top: '19%', left: '78%', width: 46, height: 46, variant: 'root', motion: 'c' },
  { top: '37%', left: '26%', width: 34, height: 34, variant: 'orb4', motion: 'a' },
  { top: '71%', left: '48%', width: 70, height: 70, variant: 'orb1', motion: 'b' },
  { top: '4%', left: '46%', width: 54, height: 54, variant: 'orb2', motion: 'd', delay: '0.2s' },
  { top: '16%', left: '92%', width: 42, height: 42, variant: 'orb3', motion: 'a' },
  { top: '30%', right: '18%', width: 62, height: 62, variant: 'root', motion: 'd' },
  { top: '46%', left: '40%', width: 32, height: 32, variant: 'orb4', motion: 'c' },
  { top: '55%', left: '76%', width: 86, height: 86, variant: 'orb1', motion: 'd', delay: '1.3s' },
  { top: '66%', left: '18%', width: 98, height: 98, variant: 'orb3', motion: 'a' },
  { top: '82%', left: '40%', width: 108, height: 108, variant: 'orb4', motion: 'b' },
  { top: '88%', right: '22%', width: 74, height: 74, variant: 'root', motion: 'c' },
  { top: '95%', left: '8%', width: 48, height: 48, variant: 'orb2', motion: 'd' },
  { top: '22%', left: '52%', width: 28, height: 28, variant: 'orb1', motion: 'b' },
  { top: '38%', left: '88%', width: 56, height: 56, variant: 'orb2', motion: 'c' },
  { top: '60%', left: '92%', width: 34, height: 34, variant: 'orb3', motion: 'd' },
  { top: '72%', right: '28%', width: 90, height: 90, variant: 'orb1', motion: 'a', delay: '0.7s' },
  { top: '8%', left: '72%', width: 64, height: 64, variant: 'orb4', motion: 'b' },
  { top: '44%', left: '8%', width: 44, height: 44, variant: 'root', motion: 'd' },
  { top: '52%', left: '34%', width: 26, height: 26, variant: 'orb2', motion: 'a' },
  { top: '28%', right: '48%', width: 78, height: 78, variant: 'orb4', motion: 'b', duration: '15s' },
  { top: '14%', left: '30%', width: 50, height: 50, variant: 'orb3', motion: 'd' },
  { top: '76%', left: '58%', width: 58, height: 58, variant: 'orb1', motion: 'c' },
  { top: '84%', left: '78%', width: 42, height: 42, variant: 'orb2', motion: 'a' },
  { top: '48%', right: '52%', width: 36, height: 36, variant: 'orb3', motion: 'd' },
  { top: '62%', left: '42%', width: 82, height: 82, variant: 'root', motion: 'b', delay: '2.2s' },
  { top: '18%', right: '52%', width: 94, height: 94, variant: 'orb4', motion: 'c' },
  { top: '56%', right: '12%', width: 30, height: 30, variant: 'orb1', motion: 'a' },
  { top: '34%', left: '64%', width: 46, height: 46, variant: 'orb3', motion: 'b' },
  { top: '70%', right: '12%', width: 66, height: 66, variant: 'orb4', motion: 'd' },
  { top: '10%', right: '28%', width: 82, height: 82, variant: 'root', motion: 'a', duration: '16s' },
  { top: '40%', right: '26%', width: 24, height: 24, variant: 'orb2', motion: 'c' },
  { top: '98%', right: '42%', width: 52, height: 52, variant: 'orb3', motion: 'b' },
  { top: '64%', right: '32%', width: 40, height: 40, variant: 'orb1', motion: 'd' },
  { top: '24%', left: '18%', width: 36, height: 36, variant: 'orb4', motion: 'a' },
  { top: '58%', left: '56%', width: 72, height: 72, variant: 'orb2', motion: 'c', delay: '1.9s' },
  { top: '32%', left: '12%', width: 88, height: 88, variant: 'orb3', motion: 'd' },
  { top: '86%', right: '6%', width: 34, height: 34, variant: 'root', motion: 'a' },
  { top: '6%', left: '16%', width: 62, height: 62, variant: 'orb1', motion: 'b' },
  { top: '50%', right: '22%', width: 48, height: 48, variant: 'orb4', motion: 'd' },
  { top: '74%', left: '2%', width: 54, height: 54, variant: 'orb3', motion: 'b' },
  { top: '20%', left: '44%', width: 142, height: 142, variant: 'orb2', motion: 'a', duration: '17s' },
  { top: '66%', left: '66%', width: 38, height: 38, variant: 'orb1', motion: 'c' },
  { top: '42%', right: '8%', width: 68, height: 68, variant: 'root', motion: 'd' },
  { top: '78%', left: '26%', width: 32, height: 32, variant: 'orb4', motion: 'b' },
  { top: '12%', left: '50%', width: 22, height: 22, variant: 'orb3', motion: 'a' },
  { top: '54%', right: '58%', width: 58, height: 58, variant: 'orb2', motion: 'c' },
  { top: '36%', right: '2%', width: 44, height: 44, variant: 'orb1', motion: 'd' },
  { top: '92%', left: '52%', width: 76, height: 76, variant: 'orb4', motion: 'a', delay: '0.15s' },
  { top: '48%', left: '92%', width: 28, height: 28, variant: 'root', motion: 'b' },
  { top: '26%', right: '2%', width: 70, height: 70, variant: 'orb3', motion: 'd' },
  { top: '60%', left: '8%', width: 46, height: 46, variant: 'orb2', motion: 'a' },
  { top: '82%', left: '64%', width: 96, height: 96, variant: 'orb1', motion: 'c', duration: '14.5s' },
]

export function DecorativePageBackground() {
  return (
    <div className='decorative-bg' aria-hidden>
      <svg className='decorative-bg-lines' viewBox='0 0 100 100' preserveAspectRatio='none'>
        <path
          className='decorative-bg-line decorative-bg-line--ebb'
          d='M8 18 Q 22 28, 35 15 T 55 22 Q 68 30, 78 18'
          vectorEffect='non-scaling-stroke'
        />
        <path
          className='decorative-bg-line decorative-bg-line--muted decorative-bg-line--ebb-slow'
          d='M12 72 Q 30 58, 48 68 T 72 62 Q 85 55, 92 48'
          vectorEffect='non-scaling-stroke'
        />
        <path
          className='decorative-bg-line decorative-bg-line--muted decorative-bg-line--ebb-delay'
          d='M88 35 Q 70 45, 52 38 T 28 48'
          vectorEffect='non-scaling-stroke'
        />
        <path
          className='decorative-bg-line decorative-bg-line--muted decorative-bg-line--ebb-wide'
          d='M50 8 Q 35 25, 50 42 Q 65 58, 50 78 Q 35 92, 52 96'
          vectorEffect='non-scaling-stroke'
        />
      </svg>
      {NODES.map((node, i) => (
        <div
          key={i}
          className={`bg-node bg-node--${node.variant} bg-node--motion-${node.motion ?? 'a'}`}
          style={{
            top: node.top,
            left: node.left,
            right: node.right,
            bottom: node.bottom,
            width: node.width,
            height: node.height,
            animationDelay: node.delay ?? `${(i % 8) * 0.28}s`,
            animationDuration: node.duration,
          }}
        />
      ))}
    </div>
  )
}
