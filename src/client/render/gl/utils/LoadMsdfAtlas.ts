/**
 * Upload the MSDF RGB distance-field atlas without browser color management
 * or alpha premultiplication. Altering even one RGB channel changes glyph
 * edges: text can render as filled rectangles instead of readable letters.
 *
 * ImageBitmap decodes the source PNG with explicit color settings. Preserve
 * WebGL's global unpack and active texture state so an asynchronously loaded
 * font cannot corrupt the texture bindings of other render passes.
 */
export async function loadMsdfAtlasTexture(
  gl: WebGL2RenderingContext,
  url: string,
  expectedWidth: number,
  expectedHeight: number,
): Promise<WebGLTexture> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MSDF atlas could not be loaded (${response.status}): ${url}`);
  }
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
    imageOrientation: "none",
  });
  try {
    if (bitmap.width !== expectedWidth || bitmap.height !== expectedHeight) {
      throw new Error(
        `MSDF atlas dimensions ${bitmap.width}x${bitmap.height} differ from ` +
          `metrics ${expectedWidth}x${expectedHeight}`,
      );
    }

    const activeUnit = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(gl.TEXTURE0);
    const boundTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const flipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
    const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
    const colorSpace = gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) as number;
    let texture: WebGLTexture | null = null;
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      texture = gl.createTexture();
      if (!texture) throw new Error("Unable to allocate MSDF atlas texture");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      return texture;
    } catch (error) {
      if (texture) gl.deleteTexture(texture);
      throw error;
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, colorSpace);
      gl.bindTexture(gl.TEXTURE_2D, boundTexture);
      gl.activeTexture(activeUnit);
    }
  } finally {
    bitmap.close();
  }
}
