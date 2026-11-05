#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
uniform mat3 uCamera;
out vec2 vUV;
out vec2 vScreen;

void main() {
  vec2 clip = aPos - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
  vScreen = aPos * 0.5;
  // Invert at the vertices, not per fragment. No extra pass or texture.
  vec3 world = inverse(uCamera) * vec3(clip, 1.0);
  vUV = world.xy / vec2(float(MAP_W), float(MAP_H));
}
