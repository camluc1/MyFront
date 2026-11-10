#version 300 es
precision highp float;

in vec2 vLocal; // [-1, +1]

uniform float uRadius;
uniform vec3 uColor;
uniform float uSelected;

out vec4 fragColor;

void main() {
  float dist = length(vLocal) * (uRadius + 1.0); // world-space distance from center
  float edge = uRadius;

  // Smooth fill: inside the circle at 20% white
  float fill = 1.0 - smoothstep(edge - 0.5, edge + 0.5, dist);

  // Stroke: 1-tile-wide ring at the edge
  float strokeInner = edge - 1.0;
  float strokeOuter = edge;
  float stroke = smoothstep(strokeInner - 0.5, strokeInner + 0.5, dist)
               * (1.0 - smoothstep(strokeOuter - 0.5, strokeOuter + 0.5, dist));

  // Inspection should reveal coverage without covering the political map.
  float alpha = fill * mix(0.2, 0.065, uSelected)
              + stroke * mix(0.5, 0.88, uSelected);
  if (alpha < 0.001) discard;

  fragColor = vec4(uColor, alpha);
}
