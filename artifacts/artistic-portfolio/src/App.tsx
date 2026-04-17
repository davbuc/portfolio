import { useEffect, useRef, useState, useCallback } from 'react';
import { FluidSimulation } from './fluid/FluidSimulation';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<FluidSimulation | null>(null);
  const [dark, setDark] = useState(false);

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
            <a
              href="https://www.linkedin.com/in/david-bucher18"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-link"
            >
              LinkedIn
            </a>
            <button className="theme-toggle" onClick={toggleDark} aria-label="Toggle dark mode">
              {dark ? '○' : '●'}
            </button>
          </nav>
        </header>

        <main className="site-main">
          <p className="bio-primary">
            Building thoughtful digital products at the intersection of design and technology.
          </p>
          <p className="bio-secondary">Design + Engineering. Based in Zurich.</p>
        </main>
      </div>
    </div>
  );
}
