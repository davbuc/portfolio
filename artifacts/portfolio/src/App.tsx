import { useEffect, useRef, useState, useCallback } from 'react';
import { FluidSimulation } from './fluid/FluidSimulation';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<FluidSimulation | null>(null);
  const [dark, setDark] = useState(false);
  const [debug, setDebug] = useState('tap to test');

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      const sim: any = simRef.current;
      const splats = sim?._splatCount ?? 'no-sim';
      setDebug(`start ${t?.clientX.toFixed(0)},${t?.clientY.toFixed(0)} splats=${splats}`);
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      const sim: any = simRef.current;
      const splats = sim?._splatCount ?? '?';
      setDebug(`move ${t?.clientX.toFixed(0)},${t?.clientY.toFixed(0)} splats=${splats}`);
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
    canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);

    try {
      simRef.current = new FluidSimulation(canvas);
    } catch (e) {
      console.error('WebGL fluid simulation failed to initialize:', e);
    }

    return () => {
      simRef.current?.destroy();
      simRef.current = null;
    };
  }, []);

  const toggleDark = useCallback(() => {
    setDark(prev => {
      const next = !prev;
      simRef.current?.setDarkMode(next);
      return next;
    });
  }, []);

  return (
    <div className={`app-container${dark ? ' dark' : ''}`}>
      <canvas ref={canvasRef} className="fluid-canvas" />
      <div className="overlay">
        <header className="site-header">
          <span className="site-name">David Bucher</span>
          <nav className="site-nav">
              <button className="theme-toggle" onClick={toggleDark} aria-label="Toggle dark mode">
              {dark ? '○' : '●'}
            </button>
          </nav>
        </header>

        <main className="site-main">
          <p className="bio-primary">
            Building thoughtful digital products at the intersection of design and technology.
          </p>
          <p className="bio-secondary">Based in Zurich</p>
          <a
            href="https://www.linkedin.com/in/david-bucher18"
            target="_blank"
            rel="noopener noreferrer"
            className="bio-secondary bio-link"
          >
            LinkedIn
          </a>
        </main>
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          padding: '8px 10px', fontSize: 11, fontFamily: 'monospace',
          background: 'rgba(255,0,0,0.9)', color: '#fff',
          pointerEvents: 'none', zIndex: 100, wordBreak: 'break-all'
        }}>{debug}</div>
      </div>
    </div>
  );
}
