export class FluidSimulation {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private dpr = window.devicePixelRatio || 1;
  
  // Program refs
  private splatProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;
  private advectionProgram!: WebGLProgram;
  private divergenceProgram!: WebGLProgram;
  private curlProgram!: WebGLProgram;
  private vorticityProgram!: WebGLProgram;
  private pressureProgram!: WebGLProgram;
  private gradientSubtractProgram!: WebGLProgram;
  private copyProgram!: WebGLProgram;

  // Framebuffer objects
  private dye: any;
  private velocity: any;
  private divergence: any;
  private curl: any;
  private pressure: any;

  // Quad geometry
  private positionBuffer!: WebGLBuffer;

  // Input
  private mouse = { x: 0, y: 0, px: 0, py: 0, down: false };
  private animationId = 0;
  private lastTime = Date.now();

  // Colors
  private bgColor = [0.94, 0.96, 0.98];
  private fluidColor = [1.0, 1.0, 1.0];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      console.error('WebGL is required but not supported');
      throw new Error('WebGL not supported');
    }
    this.gl = gl as WebGLRenderingContext;
    this.setupExtensions();
    this.compilePrograms();
    this.allocateResources();
    this.setupEventListeners();
    this.animate();
  }

  private supportsLinearFiltering = true;

  private setupExtensions() {
    const gl = this.gl;
    gl.getExtension('OES_texture_float');
    gl.getExtension('OES_texture_half_float');
    const floatLinear = gl.getExtension('OES_texture_float_linear');
    const halfLinear = gl.getExtension('OES_texture_half_float_linear');
    this.supportsLinearFiltering = !!(floatLinear || halfLinear);
  }

  private compilePrograms() {
    const gl = this.gl;

    const vertSource = `
      precision highp float;
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
        vUv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0, 1);
      }
    `;

    const splatFrag = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;
      void main() {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
      }
    `;

    const displayFrag = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform vec3 uBgColor;
      uniform vec3 uFluidColor;
      void main() {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float v = (c.r + c.g + c.b) / 3.0;
        gl_FragColor = vec4(mix(uBgColor, uFluidColor, v), 1.0);
      }
    `;

    const advectionFrag = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform float dt;
      uniform float dissipation;
      void main() {
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        vec4 result = texture2D(uSource, coord);
        gl_FragColor = result * dissipation;
      }
    `;

    const divergenceFrag = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform float texelSize;
      void main() {
        float L = texture2D(uVelocity, vUv - vec2(texelSize, 0)).x;
        float R = texture2D(uVelocity, vUv + vec2(texelSize, 0)).x;
        float T = texture2D(uVelocity, vUv + vec2(0, texelSize)).y;
        float B = texture2D(uVelocity, vUv - vec2(0, texelSize)).y;
        gl_FragColor = vec4(0.5 * (R - L + T - B), 0, 0, 1);
      }
    `;

    const curlFrag = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform float texelSize;
      void main() {
        float L = texture2D(uVelocity, vUv - vec2(texelSize, 0)).y;
        float R = texture2D(uVelocity, vUv + vec2(texelSize, 0)).y;
        float T = texture2D(uVelocity, vUv + vec2(0, texelSize)).x;
        float B = texture2D(uVelocity, vUv - vec2(0, texelSize)).x;
        gl_FragColor = vec4(0.5 * (R - L - T + B), 0, 0, 1);
      }
    `;

    const vorticityFrag = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float texelSize;
      uniform float curl;
      uniform float dt;
      void main() {
        float L = texture2D(uCurl, vUv - vec2(texelSize, 0)).x;
        float R = texture2D(uCurl, vUv + vec2(texelSize, 0)).x;
        float T = texture2D(uCurl, vUv + vec2(0, texelSize)).x;
        float B = texture2D(uCurl, vUv - vec2(0, texelSize)).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;
        vec2 vel = texture2D(uVelocity, vUv).xy;
        gl_FragColor = vec4(vel + force * dt, 0, 1);
      }
    `;

    const pressureFrag = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      uniform float texelSize;
      void main() {
        float L = texture2D(uPressure, vUv - vec2(texelSize, 0)).x;
        float R = texture2D(uPressure, vUv + vec2(texelSize, 0)).x;
        float T = texture2D(uPressure, vUv + vec2(0, texelSize)).x;
        float B = texture2D(uPressure, vUv - vec2(0, texelSize)).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0, 0, 1);
      }
    `;

    const gradientFrag = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      uniform float texelSize;
      void main() {
        float L = texture2D(uPressure, vUv - vec2(texelSize, 0)).x;
        float R = texture2D(uPressure, vUv + vec2(texelSize, 0)).x;
        float T = texture2D(uPressure, vUv + vec2(0, texelSize)).x;
        float B = texture2D(uPressure, vUv - vec2(0, texelSize)).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0, 1);
      }
    `;

    this.splatProgram = this.createProgram(vertSource, splatFrag);
    this.displayProgram = this.createProgram(vertSource, displayFrag);
    this.advectionProgram = this.createProgram(vertSource, advectionFrag);
    this.divergenceProgram = this.createProgram(vertSource, divergenceFrag);
    this.curlProgram = this.createProgram(vertSource, curlFrag);
    this.vorticityProgram = this.createProgram(vertSource, vorticityFrag);
    this.pressureProgram = this.createProgram(vertSource, pressureFrag);
    this.gradientSubtractProgram = this.createProgram(vertSource, gradientFrag);
    this.copyProgram = this.createProgram(vertSource, `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      void main() {
        gl_FragColor = texture2D(uTexture, vUv);
      }
    `);
  }

  private createProgram(vertSource: string, fragSource: string) {
    const gl = this.gl;
    const vert = this.compileShader(gl.VERTEX_SHADER, vertSource);
    const frag = this.compileShader(gl.FRAGMENT_SHADER, fragSource);
    const program = gl.createProgram()!;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
    }
    return program;
  }

  private compileShader(type: number, source: string) {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  private allocateResources() {
    const gl = this.gl;
    const width = 512;
    const height = 512;

    // Setup position buffer for full-screen quad
    this.positionBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    // Setup textures — pick a format that actually works as a render target.
    // iOS Safari accepts OES_texture_half_float but NOT OES_texture_float for
    // FBO attachments, so we must probe which one round-trips correctly.
    const halfFloatExt = gl.getExtension('OES_texture_half_float');
    const floatExt = gl.getExtension('OES_texture_float');
    const HALF_FLOAT_OES = halfFloatExt ? halfFloatExt.HALF_FLOAT_OES : 0x8D61;
    const internalFormat = gl.RGBA;
    const format = gl.RGBA;

    const supportsFormat = (type: number) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
      return ok;
    };

    let texType: number;
    if (halfFloatExt && supportsFormat(HALF_FLOAT_OES)) {
      texType = HALF_FLOAT_OES;
    } else if (floatExt && supportsFormat(gl.FLOAT)) {
      texType = gl.FLOAT;
    } else {
      texType = gl.UNSIGNED_BYTE;
    }

    this.dye = this.createDoubleFBO(width, height, internalFormat, format, texType);
    this.velocity = this.createDoubleFBO(width, height, internalFormat, format, texType);
    this.divergence = this.createFBO(width, height, internalFormat, format, texType);
    this.curl = this.createFBO(width, height, internalFormat, format, texType);
    this.pressure = this.createDoubleFBO(width, height, internalFormat, format, texType);

    gl.clearColor(0.94, 0.96, 0.98, 1);
  }

  private createFBO(w: number, h: number, internalFormat: number, format: number, type: number) {
    const gl = this.gl;
    const filter = this.supportsLinearFiltering ? gl.LINEAR : gl.NEAREST;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return { texture, fbo, w, h, texelSize: 1 / w };
  }

  private createDoubleFBO(w: number, h: number, internalFormat: number, format: number, type: number) {
    const fbo0 = this.createFBO(w, h, internalFormat, format, type);
    const fbo1 = this.createFBO(w, h, internalFormat, format, type);
    const obj: any = {
      read: fbo0,
      write: fbo1,
      swap() {
        const tmp = obj.read;
        obj.read = obj.write;
        obj.write = tmp;
      },
    };
    return obj;
  }

  private updatePointer(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.px = this.mouse.x;
    this.mouse.py = this.mouse.y;
    this.mouse.x = (clientX - rect.left) / rect.width;
    this.mouse.y = 1 - (clientY - rect.top) / rect.height;
  }

  private setupEventListeners() {
    // Unified pointer handling — works for mouse, touch, and pen.
    // Splat directly from handlers (don't rely on frame-diff detection,
    // which misses stationary taps and throttled iOS touchmove).
    const pointerDown = (clientX: number, clientY: number) => {
      this.updatePointer(clientX, clientY);
      this.mouse.px = this.mouse.x;
      this.mouse.py = this.mouse.y;
      this.mouse.down = true;
      // Stationary tap: emit a small cluster of jittered splats with
      // weak random velocities so the result looks organic and uneven
      // rather than a clean circle or ellipse.
      const cx = this.mouse.x;
      const cy = this.mouse.y;
      const jitter = 0.012;
      const vel = 60;
      for (let i = 0; i < 4; i++) {
        const ox = (Math.random() - 0.5) * jitter;
        const oy = (Math.random() - 0.5) * jitter;
        const vx = (Math.random() - 0.5) * vel;
        const vy = (Math.random() - 0.5) * vel;
        this.splat(cx + ox, cy + oy, vx, vy);
      }
    };

    const pointerMove = (clientX: number, clientY: number) => {
      const rect = this.canvas.getBoundingClientRect();
      const nx = (clientX - rect.left) / rect.width;
      const ny = 1 - (clientY - rect.top) / rect.height;
      const dx = (nx - this.mouse.x) * 500;
      const dy = (ny - this.mouse.y) * 500;
      this.mouse.px = this.mouse.x;
      this.mouse.py = this.mouse.y;
      this.mouse.x = nx;
      this.mouse.y = ny;
      if (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001) {
        this.splat(nx, ny, dx, dy);
      }
    };

    const pointerUp = () => {
      this.mouse.down = false;
    };

    // Mouse (kept for broad compatibility)
    document.addEventListener('mousemove', (e) => pointerMove(e.clientX, e.clientY));
    document.addEventListener('mousedown', (e) => pointerDown(e.clientX, e.clientY));
    document.addEventListener('mouseup', pointerUp);

    // Touch — passive listeners so we don't kill tap-to-click synthesis
    // on links/buttons. Gesture prevention is handled via CSS touch-action.
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      const t = e.touches[0];
      pointerDown(t.clientX, t.clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      const t = e.touches[0];
      pointerMove(t.clientX, t.clientY);
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove',  onTouchMove,  { passive: true });
    document.addEventListener('touchend',    pointerUp);
    document.addEventListener('touchcancel', pointerUp);
  }

  private animate = () => {
    const now = Date.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.016);
    this.lastTime = now;

    // Always splat on mouse movement (not just when clicking)
    const dx = (this.mouse.x - this.mouse.px) * 500;
    const dy = (this.mouse.y - this.mouse.py) * 500;
    if (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001) {
      this.splat(this.mouse.x, this.mouse.y, dx, dy);
    }

    this.step(dt);
    this.render();

    this.animationId = requestAnimationFrame(this.animate);
  };

  private splat(x: number, y: number, dx: number, dy: number) {
    const gl = this.gl;
    const aspectRatio = this.canvas.width / this.canvas.height;

    // Smaller radius on touch devices so the effect feels proportional
    // to a fingertip rather than a cursor.
    const isTouch = typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
    const velRadius = isTouch ? 0.010 : 0.02;
    const dyeRadius = isTouch ? 0.013 : 0.025;
    const velScale = isTouch ? 0.25 : 0.5;

    // Splat velocity
    this.bindFbo(this.velocity.write);
    gl.useProgram(this.splatProgram);
    this.setupQuad(this.splatProgram);
    gl.uniform1i(gl.getUniformLocation(this.splatProgram, 'uTarget'), 0);
    gl.uniform1f(gl.getUniformLocation(this.splatProgram, 'aspectRatio'), aspectRatio);
    gl.uniform2f(gl.getUniformLocation(this.splatProgram, 'point'), x, y);
    gl.uniform3f(gl.getUniformLocation(this.splatProgram, 'color'), dx * velScale, dy * velScale, 0);
    gl.uniform1f(gl.getUniformLocation(this.splatProgram, 'radius'), velRadius);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.velocity.swap();

    // Splat dye
    this.bindFbo(this.dye.write);
    gl.uniform2f(gl.getUniformLocation(this.splatProgram, 'point'), x, y);
    gl.uniform3f(gl.getUniformLocation(this.splatProgram, 'color'), 0.8, 0.8, 0.8);
    gl.uniform1f(gl.getUniformLocation(this.splatProgram, 'radius'), dyeRadius);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dye.read.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.dye.swap();
  }

  private step(dt: number) {
    const gl = this.gl;
    const texelSize = 1 / 512;

    // Advect velocity
    this.bindFbo(this.velocity.write);
    gl.useProgram(this.advectionProgram);
    this.setupQuad(this.advectionProgram);
    gl.uniform1i(gl.getUniformLocation(this.advectionProgram, 'uVelocity'), 0);
    gl.uniform1i(gl.getUniformLocation(this.advectionProgram, 'uSource'), 1);
    gl.uniform2f(gl.getUniformLocation(this.advectionProgram, 'texelSize'), texelSize, texelSize);
    gl.uniform1f(gl.getUniformLocation(this.advectionProgram, 'dt'), dt);
    gl.uniform1f(gl.getUniformLocation(this.advectionProgram, 'dissipation'), 0.98);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.velocity.swap();

    // Curl
    this.bindFbo(this.curl);
    gl.useProgram(this.curlProgram);
    this.setupQuad(this.curlProgram);
    gl.uniform1i(gl.getUniformLocation(this.curlProgram, 'uVelocity'), 0);
    gl.uniform1f(gl.getUniformLocation(this.curlProgram, 'texelSize'), texelSize);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Vorticity
    this.bindFbo(this.velocity.write);
    gl.useProgram(this.vorticityProgram);
    this.setupQuad(this.vorticityProgram);
    gl.uniform1i(gl.getUniformLocation(this.vorticityProgram, 'uVelocity'), 0);
    gl.uniform1i(gl.getUniformLocation(this.vorticityProgram, 'uCurl'), 1);
    gl.uniform1f(gl.getUniformLocation(this.vorticityProgram, 'texelSize'), texelSize);
    gl.uniform1f(gl.getUniformLocation(this.vorticityProgram, 'curl'), 30);
    gl.uniform1f(gl.getUniformLocation(this.vorticityProgram, 'dt'), dt);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curl.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.velocity.swap();

    // Divergence
    this.bindFbo(this.divergence);
    gl.useProgram(this.divergenceProgram);
    this.setupQuad(this.divergenceProgram);
    gl.uniform1i(gl.getUniformLocation(this.divergenceProgram, 'uVelocity'), 0);
    gl.uniform1f(gl.getUniformLocation(this.divergenceProgram, 'texelSize'), texelSize);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Pressure solve
    gl.useProgram(this.pressureProgram);
    for (let i = 0; i < 20; i++) {
      this.bindFbo(this.pressure.write);
      this.setupQuad(this.pressureProgram);
      gl.uniform1i(gl.getUniformLocation(this.pressureProgram, 'uPressure'), 0);
      gl.uniform1i(gl.getUniformLocation(this.pressureProgram, 'uDivergence'), 1);
      gl.uniform1f(gl.getUniformLocation(this.pressureProgram, 'texelSize'), texelSize);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.divergence.texture);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.pressure.swap();
    }

    // Gradient subtract
    this.bindFbo(this.velocity.write);
    gl.useProgram(this.gradientSubtractProgram);
    this.setupQuad(this.gradientSubtractProgram);
    gl.uniform1i(gl.getUniformLocation(this.gradientSubtractProgram, 'uPressure'), 0);
    gl.uniform1i(gl.getUniformLocation(this.gradientSubtractProgram, 'uVelocity'), 1);
    gl.uniform1f(gl.getUniformLocation(this.gradientSubtractProgram, 'texelSize'), texelSize);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.velocity.swap();

    // Advect dye
    this.bindFbo(this.dye.write);
    gl.useProgram(this.advectionProgram);
    this.setupQuad(this.advectionProgram);
    gl.uniform1i(gl.getUniformLocation(this.advectionProgram, 'uVelocity'), 0);
    gl.uniform1i(gl.getUniformLocation(this.advectionProgram, 'uSource'), 1);
    gl.uniform2f(gl.getUniformLocation(this.advectionProgram, 'texelSize'), texelSize, texelSize);
    gl.uniform1f(gl.getUniformLocation(this.advectionProgram, 'dt'), dt);
    gl.uniform1f(gl.getUniformLocation(this.advectionProgram, 'dissipation'), 0.99);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.dye.read.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.dye.swap();
  }

  private render() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this.displayProgram);
    this.setupQuad(this.displayProgram);
    gl.uniform1i(gl.getUniformLocation(this.displayProgram, 'uTexture'), 0);
    gl.uniform3f(gl.getUniformLocation(this.displayProgram, 'uBgColor'), this.bgColor[0], this.bgColor[1], this.bgColor[2]);
    gl.uniform3f(gl.getUniformLocation(this.displayProgram, 'uFluidColor'), this.fluidColor[0], this.fluidColor[1], this.fluidColor[2]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dye.read.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  setDarkMode(dark: boolean) {
    if (dark) {
      this.bgColor = [0.0, 0.0, 0.0];
      this.fluidColor = [1.0, 1.0, 1.0];
      this.gl.clearColor(0, 0, 0, 1);
    } else {
      this.bgColor = [0.94, 0.96, 0.98];
      this.fluidColor = [1.0, 1.0, 1.0];
      this.gl.clearColor(0.94, 0.96, 0.98, 1);
    }
  }

  private bindFbo(fbo: any) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
    gl.viewport(0, 0, fbo.w, fbo.h);
  }

  private setupQuad(program: WebGLProgram) {
    const gl = this.gl;
    const posAttrib = gl.getAttribLocation(program, 'position');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(posAttrib);
    gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 0, 0);
  }

  destroy() {
    cancelAnimationFrame(this.animationId);
  }
}
