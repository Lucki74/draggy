import { useEffect, useRef } from "react";

/** A soft moving cloud that holds the picture's place while it is drawn. It says nothing about progress, since the engine reports none. */

const FRAG = `precision mediump float;uniform float t;uniform vec2 res;
vec2 h(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return -1.+2.*fract(sin(p)*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(dot(h(i),f),dot(h(i+vec2(1,0)),f-vec2(1,0)),u.x),mix(dot(h(i+vec2(0,1)),f-vec2(0,1)),dot(h(i+vec2(1,1)),f-vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int k=0;k<5;k++){v+=a*n(p);p*=2.02;a*=.5;}return v;}
void main(){vec2 uv=gl_FragCoord.xy/res;uv.x*=res.x/res.y;float s=t*.12;
vec2 q=vec2(fbm(uv*1.6+s),fbm(uv*1.6-s+4.1));float v=fbm(uv*2.2+q*1.6+vec2(s*.6,-s*.4))*.5+.5;
vec3 a=vec3(.86,.88,.91),b=vec3(.60,.66,.75),c=vec3(.95,.95,.96);
gl_FragColor=vec4(mix(mix(b,a,smoothstep(.25,.6,v)),c,smoothstep(.6,.85,v)),1.);}`;

const W = 92;
const H = 69;

export function NoiseThumb({ dim }: { dim?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext("webgl");
    if (!canvas || !gl) return;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type) as WebGLShader;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const program = gl.createProgram() as WebGLProgram;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}"));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const time = gl.getUniformLocation(program, "t");
    canvas.width = W;
    canvas.height = H;
    gl.viewport(0, 0, W, H);
    gl.uniform2f(gl.getUniformLocation(program, "res"), W, H);
    const start = performance.now() - Math.random() * 9000;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const draw = (now: number) => {
      gl.uniform1f(time, (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!still) frame = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={ref} aria-hidden="true" className={`nz${dim ? " dim" : ""}`} />;
}
