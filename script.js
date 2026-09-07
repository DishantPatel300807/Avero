document.addEventListener("DOMContentLoaded", () => {
  // Equivalent of the React component's props
  const config = {
    bg: "#000000",
    colors: ["#cbbb71", "#ded4a7", "#f6ea17", "#676312"],
    speed: 2.0,
    grain: 0.3,
  };

  const vertexShaderGLSL = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

  const fragmentShaderGLSL = `
precision highp float;
varying vec2 vUv;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_grain;
uniform vec3 u_colors[4];
uniform vec3 u_bg;

vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
           + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
               dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vec2 uv = vUv;
  float ratio = u_resolution.x / u_resolution.y;
  vec2 p = uv - 0.5;
  p.x *= ratio;

  float t = u_time * 0.1;

  float n1 = snoise(p * 0.4 + vec2(t * 0.2, -t * 0.3));
  float n2 = snoise(p * 0.55 + vec2(-t * 0.15, t * 0.25) + n1 * 0.25);
  float n3 = snoise(p * 0.75 + vec2(t * 0.1, -t * 0.2) + n2 * 0.2);

  vec3 col = u_bg;

  float dist = length(p) * 1.5;
  float vignette = 1.0 - smoothstep(0.3, 1.2, dist);

  col = mix(col, u_colors[0], smoothstep(-0.2, 0.5, n1) * 0.85);
  col = mix(col, u_colors[1], smoothstep(-0.1, 0.6, n2) * 0.7);
  col = mix(col, u_colors[2], smoothstep(-0.3, 0.4, n3) * 0.6);
  col = mix(col, u_colors[3], smoothstep(0.0, 0.7, n1 * n2) * 0.5);

  float glow = smoothstep(0.8, 0.0, dist) * 0.3;
  col += u_colors[1] * glow;

  col = mix(col * 0.2, col, vignette);

  float grain = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453 + u_time);
  col += (grain - 0.5) * u_grain * 0.1;

  gl_FragColor = vec4(col, 1.0);
}
`;

  const hexToRgb = (hex) => {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ];
  };

  const canvas = document.getElementById("velaris-canvas");
  const container = document.getElementById("velaris-container");
  if (!canvas || !container) return;

  const gl = canvas.getContext("webgl");
  if (!gl) {
    console.error("WebGL not supported");
    return;
  }

  const createShader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
    }
    return s;
  };

  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl.VERTEX_SHADER, vertexShaderGLSL));
  gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fragmentShaderGLSL));
  gl.linkProgram(program);
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );

  const pos = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

  const locs = {
    res: gl.getUniformLocation(program, "u_resolution"),
    time: gl.getUniformLocation(program, "u_time"),
    grain: gl.getUniformLocation(program, "u_grain"),
    colors: gl.getUniformLocation(program, "u_colors"),
    bg: gl.getUniformLocation(program, "u_bg"),
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  // Prefer ResizeObserver (tracks container size changes directly);
  // fall back to window resize if unavailable.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(resize);
    ro.observe(container);
  } else {
    window.addEventListener("resize", resize);
  }
  resize();

  const render = (t) => {
    gl.uniform2f(locs.res, canvas.width, canvas.height);
    gl.uniform1f(locs.time, t * 0.001 * config.speed);
    gl.uniform1f(locs.grain, config.grain);
    gl.uniform3f(locs.bg, ...hexToRgb(config.bg));

    const flat = new Float32Array(config.colors.slice(0, 4).flatMap(hexToRgb));
    gl.uniform3fv(locs.colors, flat);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
  };

  requestAnimationFrame(render);

  // --- New SVG Cursor Animation Logic ---
  const cursor = document.getElementById("target-cursor");
  const snapTargets = document.querySelectorAll(".nav-bar a, .search-input");

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let cursorX = mouseX;
  let cursorY = mouseY;
  let isHovering = false;

  window.addEventListener("mousemove", (e) => {
    if (!isHovering) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }
  });

const snapBox = document.querySelector(".cursor-snap-box");

  snapTargets.forEach(target => {
    target.addEventListener("mouseenter", () => {
      isHovering = true;
      cursor.classList.add("is-hovering"); 
      
      const rect = target.getBoundingClientRect();
      
      // Lock to center of target
      mouseX = rect.left + rect.width / 2;
      mouseY = rect.top + rect.height / 2;

      // Make the snap box fit the target exactly, plus 16px of padding
      snapBox.style.width = `${rect.width + 16}px`;
      snapBox.style.height = `${rect.height + 16}px`;
    });

    target.addEventListener("mouseleave", () => {
      isHovering = false;
      cursor.classList.remove("is-hovering"); 
      
      // Reset box size when leaving
      snapBox.style.width = "0px";
      snapBox.style.height = "0px";
    });
  });

  const lerp = (start, end, factor) => start + (end - start) * factor;

  const animateCursor = () => {
    cursorX = lerp(cursorX, mouseX, 0.2); 
    cursorY = lerp(cursorY, mouseY, 0.2);
    
    cursor.style.left = `${cursorX}px`;
    cursor.style.top = `${cursorY}px`;
    
    requestAnimationFrame(animateCursor);
  };

  animateCursor();

});