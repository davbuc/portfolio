import { useEffect, useRef, useState, useCallback } from 'react';
import { FluidSimulation } from './fluid/FluidSimulation';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<FluidSimulation | null>(null);
  const [dark, setDark] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

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

  useEffect(() => {
    let hideTimer: number | undefined;
    const show = (x: number, y: number) => {
      setCoords({ x: Math.round(x), y: Math.round(y) });
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setCoords(null), 800);
    };
    const onMouse = (e: MouseEvent) => show(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) show(t.clientX, t.clientY);
    };
    document.addEventListener('mousemove', onMouse);
    document.addEventListener('touchstart', onTouch, { passive: true });
    document.addEventListener('touchmove', onTouch, { passive: true });
    return () => {
      document.removeEventListener('mousemove', onMouse);
      document.removeEventListener('touchstart', onTouch);
      document.removeEventListener('touchmove', onTouch);
      if (hideTimer) window.clearTimeout(hideTimer);
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
          <div className="site-identity">
            <span className="site-name">David Bucher</span>
            <span className={`site-coords${coords ? ' visible' : ''}`}>
              {coords ? `${coords.x}, ${coords.y}` : '\u00A0'}
            </span>
          </div>
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
      </div>
    </div>
  );
}
