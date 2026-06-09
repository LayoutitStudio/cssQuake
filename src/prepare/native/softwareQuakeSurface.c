// Standalone software Quake mip0 surface-cache oracle for deterministic atlas checks.
// The renderer function structure and arithmetic mirror id Software's GPL Quake
// source: WinQuake/r_surf.c R_BuildLightMap, R_DrawSurface, and
// R_DrawSurfaceBlock8_mip0. This helper intentionally excludes dynamic lights
// and screen-space mip selection; the caller passes an already-selected mip0
// static world surface.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define VID_CBITS 6
#define MAXLIGHTMAPS 4
#define REQUEST_MAGIC 0x46525351u
#define RESPONSE_MAGIC 0x314f5351u

typedef struct {
  int texturemins[2];
  int extents[2];
} oracle_surface_t;

typedef struct {
  oracle_surface_t *surf;
  const uint8_t *texture;
  const uint8_t *lightmap;
  const uint8_t *colormap;
  uint32_t lightadj[MAXLIGHTMAPS];
  uint32_t style_count;
  int texture_width;
  int texture_height;
  int surfwidth;
  int surfheight;
  int rowbytes;
  uint8_t *surfdat;
} drawsurf_t;

typedef struct {
  uint32_t magic;
  uint32_t texture_width;
  uint32_t texture_height;
  uint32_t extent_s;
  uint32_t extent_t;
  int32_t texture_min_s;
  int32_t texture_min_t;
  uint32_t style_count;
  uint32_t sample_count;
  uint32_t texture_len;
  uint32_t lightmap_len;
  uint32_t colormap_len;
  uint32_t palette_len;
  uint32_t lightadj[MAXLIGHTMAPS];
} request_header_t;

typedef struct {
  uint32_t magic;
  uint32_t width;
  uint32_t height;
  uint32_t payload_len;
} response_header_t;

static drawsurf_t r_drawsurf;
static uint32_t *blocklights;
static int r_lightwidth;
static int r_numhblocks;
static int r_numvblocks;
static int surfrowbytes;
static int sourcetstep;
static int r_stepback;
static const uint8_t *r_source;
static const uint8_t *r_sourcemax;
static const uint8_t *pbasesource;
static uint8_t *prowdestbase;
static uint8_t *rowdestbase;
static uint32_t *r_lightptr;
static int lightleft;
static int lightright;
static int lightleftstep;
static int lightrightstep;
static uint8_t *lightrows;

static int read_exact(void *target, size_t size) {
  return fread(target, 1, size, stdin) == size;
}

static int write_exact(const void *source, size_t size) {
  return fwrite(source, 1, size, stdout) == size;
}

static void *checked_malloc(size_t size) {
  void *ptr = malloc(size ? size : 1);
  if (!ptr) exit(2);
  return ptr;
}

static int positive_mod(int value, int size) {
  int out = value % size;
  return out < 0 ? out + size : out;
}

static void R_BuildLightMap(void) {
  int smax = (r_drawsurf.surf->extents[0] >> 4) + 1;
  int tmax = (r_drawsurf.surf->extents[1] >> 4) + 1;
  int size = smax * tmax;
  const uint8_t *lightmap = r_drawsurf.lightmap;

  for (int i = 0; i < size; i++) {
    blocklights[i] = 0;
  }

  if (lightmap) {
    for (uint32_t maps = 0; maps < r_drawsurf.style_count; maps++) {
      uint32_t scale = r_drawsurf.lightadj[maps];
      for (int i = 0; i < size; i++) {
        blocklights[i] += lightmap[i] * scale;
      }
      lightmap += size;
    }
  }

  for (int i = 0; i < size; i++) {
    int t = (255 * 256 - (int)blocklights[i]) >> (8 - VID_CBITS);
    if (t < (1 << 6)) t = (1 << 6);
    blocklights[i] = (uint32_t)t;
  }
}

static void R_DrawSurfaceBlock8_mip0(void) {
  int v, i, b, lightstep, lighttemp, light;
  uint8_t pix;
  const uint8_t *psource;
  uint8_t *prowdest;
  uint8_t *prowrow;

  psource = pbasesource;
  prowdest = prowdestbase;
  prowrow = rowdestbase;

  for (v = 0; v < r_numvblocks; v++) {
    lightleft = (int)r_lightptr[0];
    lightright = (int)r_lightptr[1];
    r_lightptr += r_lightwidth;
    lightleftstep = ((int)r_lightptr[0] - lightleft) >> 4;
    lightrightstep = ((int)r_lightptr[1] - lightright) >> 4;

    for (i = 0; i < 16; i++) {
      lighttemp = lightleft - lightright;
      lightstep = lighttemp >> 4;
      light = lightright;

      for (b = 15; b >= 0; b--) {
        pix = psource[b];
        prowdest[b] = r_drawsurf.colormap[(light & 0xFF00) + pix];
        prowrow[b] = (uint8_t)((light & 0xFF00) >> 8);
        light += lightstep;
      }

      psource += sourcetstep;
      lightright += lightrightstep;
      lightleft += lightleftstep;
      prowdest += surfrowbytes;
      prowrow += surfrowbytes;
    }

    if (psource >= r_sourcemax) psource -= r_stepback;
  }
}

static void R_DrawSurface(void) {
  int smax, tmax, twidth;
  int u;
  int soffset, basetoffset, texwidth;
  int horzblockstep;
  uint8_t *pcolumndest;
  uint8_t *pcolumnrow;
  const uint8_t *basetptr;

  R_BuildLightMap();

  surfrowbytes = r_drawsurf.rowbytes;
  r_source = r_drawsurf.texture;

  texwidth = r_drawsurf.texture_width;
  r_lightwidth = (r_drawsurf.surf->extents[0] >> 4) + 1;
  r_numhblocks = r_drawsurf.surfwidth >> 4;
  r_numvblocks = r_drawsurf.surfheight >> 4;

  horzblockstep = 16;
  smax = r_drawsurf.texture_width;
  twidth = texwidth;
  tmax = r_drawsurf.texture_height;
  sourcetstep = texwidth;
  r_stepback = tmax * twidth;
  r_sourcemax = r_source + (tmax * smax);

  soffset = r_drawsurf.surf->texturemins[0];
  basetoffset = r_drawsurf.surf->texturemins[1];
  soffset = positive_mod(soffset + (smax << 16), smax);
  basetptr = &r_source[positive_mod(basetoffset + (tmax << 16), tmax) * twidth];

  pcolumndest = r_drawsurf.surfdat;
  pcolumnrow = lightrows;

  for (u = 0; u < r_numhblocks; u++) {
    r_lightptr = blocklights + u;
    prowdestbase = pcolumndest;
    rowdestbase = pcolumnrow;
    pbasesource = basetptr + soffset;
    R_DrawSurfaceBlock8_mip0();

    soffset = soffset + 16;
    if (soffset >= smax) soffset = 0;

    pcolumndest += horzblockstep;
    pcolumnrow += horzblockstep;
  }
}

static int handle_request(const request_header_t *header) {
  if (header->magic != REQUEST_MAGIC) return 0;
  if (!header->texture_width || !header->texture_height || !header->extent_s || !header->extent_t) return 0;
  if ((header->extent_s & 15) || (header->extent_t & 15)) return 0;
  if (header->style_count > MAXLIGHTMAPS) return 0;
  if (header->colormap_len != 256u * (1u << VID_CBITS) || header->palette_len != 256u * 3u) return 0;
  if (header->texture_len != header->texture_width * header->texture_height) return 0;
  if (header->sample_count != ((header->extent_s >> 4) + 1) * ((header->extent_t >> 4) + 1)) return 0;
  if (header->lightmap_len != header->style_count * header->sample_count) return 0;

  uint8_t *texture = checked_malloc(header->texture_len);
  uint8_t *lightmap = checked_malloc(header->lightmap_len);
  uint8_t *colormap = checked_malloc(header->colormap_len);
  uint8_t *palette = checked_malloc(header->palette_len);
  uint8_t *surface = checked_malloc(header->extent_s * header->extent_t);
  uint8_t *rows = checked_malloc(header->extent_s * header->extent_t);
  uint8_t *payload = checked_malloc(header->extent_s * header->extent_t * 4u);
  uint32_t *lights = checked_malloc(header->sample_count * sizeof(uint32_t));

  if (!read_exact(texture, header->texture_len) ||
      !read_exact(lightmap, header->lightmap_len) ||
      !read_exact(colormap, header->colormap_len) ||
      !read_exact(palette, header->palette_len)) {
    free(texture);
    free(lightmap);
    free(colormap);
    free(palette);
    free(surface);
    free(rows);
    free(payload);
    free(lights);
    return 0;
  }

  oracle_surface_t surf;
  surf.texturemins[0] = header->texture_min_s;
  surf.texturemins[1] = header->texture_min_t;
  surf.extents[0] = (int)header->extent_s;
  surf.extents[1] = (int)header->extent_t;

  memset(surface, 0, header->extent_s * header->extent_t);
  memset(rows, 0, header->extent_s * header->extent_t);
  blocklights = lights;
  lightrows = rows;
  r_drawsurf.surf = &surf;
  r_drawsurf.texture = texture;
  r_drawsurf.lightmap = lightmap;
  r_drawsurf.colormap = colormap;
  r_drawsurf.style_count = header->style_count;
  r_drawsurf.texture_width = (int)header->texture_width;
  r_drawsurf.texture_height = (int)header->texture_height;
  r_drawsurf.surfwidth = (int)header->extent_s;
  r_drawsurf.surfheight = (int)header->extent_t;
  r_drawsurf.rowbytes = (int)header->extent_s;
  r_drawsurf.surfdat = surface;
  for (int i = 0; i < MAXLIGHTMAPS; i++) r_drawsurf.lightadj[i] = header->lightadj[i];

  R_DrawSurface();

  for (uint32_t i = 0; i < header->extent_s * header->extent_t; i++) {
    uint8_t index = surface[i];
    payload[i * 4u] = palette[index * 3u];
    payload[i * 4u + 1u] = palette[index * 3u + 1u];
    payload[i * 4u + 2u] = palette[index * 3u + 2u];
    payload[i * 4u + 3u] = rows[i];
  }

  response_header_t response;
  response.magic = RESPONSE_MAGIC;
  response.width = header->extent_s;
  response.height = header->extent_t;
  response.payload_len = header->extent_s * header->extent_t * 4u;

  int ok = write_exact(&response, sizeof(response)) && write_exact(payload, response.payload_len);
  fflush(stdout);

  free(texture);
  free(lightmap);
  free(colormap);
  free(palette);
  free(surface);
  free(rows);
  free(payload);
  free(lights);
  return ok;
}

int main(void) {
  for (;;) {
    request_header_t header;
    size_t got = fread(&header, 1, sizeof(header), stdin);
    if (got == 0) return 0;
    if (got != sizeof(header)) return 1;
    if (!handle_request(&header)) return 1;
  }
}
