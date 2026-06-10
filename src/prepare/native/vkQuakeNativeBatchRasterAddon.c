#define _POSIX_C_SOURCE 200809L

// Batched in-process Node-API helper for deterministic vkQuake-world atlas leaves.
// The math mirrors deterministicAtlas.mjs full-coverage single-source rastering.
#include <math.h>
#include <node_api.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#define DOUBLE_COUNT 32u
#define META_COUNT 17u
#define QUAKE_LIGHT_SAMPLE_SIZE 16.0
#define VKQUAKE_LIGHTMAP_QUANTIZATION 16.0
#define VKQUAKE_WORLD_LIGHTMAP_MULTIPLIER 2.0

typedef struct {
  const uint8_t *data;
  size_t length;
} uint8_view_t;

typedef struct {
  uint8_t *data;
  size_t length;
} output_view_t;

typedef struct {
  const int32_t *data;
  size_t length;
} int32_view_t;

typedef struct {
  const double *data;
  size_t length;
} double_view_t;

typedef struct {
  uint32_t width;
  uint32_t height;
  uint32_t texture_index;
  uint32_t texture_width;
  uint32_t texture_height;
  int32_t lighting_index;
  int32_t light_offset;
  uint32_t light_width;
  uint32_t light_height;
  uint32_t light_sample_count;
  int32_t light_min_s;
  int32_t light_min_t;
  uint32_t style_count;
  uint32_t style_scales[4];
} job_meta_t;

typedef struct {
  const job_meta_t *meta;
  const double *doubles;
  const uint8_view_t *textures;
  const uint8_view_t *lightings;
  const uint8_view_t *palette;
  const uint8_view_t *lut;
  output_view_t *output;
} raster_job_t;

typedef struct {
  uint32_t constant_jobs;
  uint32_t variable_jobs;
  uint64_t constant_pixels;
  uint64_t variable_pixels;
  uint64_t constant_render_ns;
  uint64_t variable_render_ns;
} batch_stats_t;

static int native_raster_timing_enabled(void) {
  const char *value = getenv("QUAKE_NATIVE_RASTER_TIMING");
  return value && value[0] && value[0] != '0';
}

static uint64_t native_raster_now_ns(void) {
#ifdef CLOCK_MONOTONIC
  struct timespec ts;
  if (clock_gettime(CLOCK_MONOTONIC, &ts) == 0) {
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
  }
#endif
  return (uint64_t)(((double)clock() * 1000000000.0) / CLOCKS_PER_SEC);
}

static double native_raster_ns_to_ms(uint64_t ns) {
  return (double)ns / 1000000.0;
}

static napi_value boolean_value(napi_env env, int value) {
  napi_value out;
  napi_get_boolean(env, value, &out);
  return out;
}

static int get_array_length(napi_env env, napi_value value, uint32_t *length) {
  bool is_array = false;
  if (napi_is_array(env, value, &is_array) != napi_ok || !is_array) return 0;
  return napi_get_array_length(env, value, length) == napi_ok;
}

static int get_uint8_view(napi_env env, napi_value value, uint8_view_t *out) {
  out->data = NULL;
  out->length = 0;

  bool is_buffer = false;
  if (napi_is_buffer(env, value, &is_buffer) == napi_ok && is_buffer) {
    void *data = NULL;
    size_t length = 0;
    if (napi_get_buffer_info(env, value, &data, &length) != napi_ok) return 0;
    out->data = (const uint8_t *)data;
    out->length = length;
    return 1;
  }

  napi_typedarray_type type;
  size_t length = 0;
  void *data = NULL;
  napi_value arraybuffer;
  size_t byte_offset = 0;
  if (napi_get_typedarray_info(env, value, &type, &length, &data, &arraybuffer, &byte_offset) != napi_ok) {
    return 0;
  }
  if (type != napi_uint8_array && type != napi_uint8_clamped_array) return 0;
  out->data = (const uint8_t *)data;
  out->length = length;
  return 1;
}

static int get_output_view(napi_env env, napi_value value, output_view_t *out) {
  uint8_view_t view;
  if (!get_uint8_view(env, value, &view)) return 0;
  out->data = (uint8_t *)view.data;
  out->length = view.length;
  return 1;
}

static int get_double_view(napi_env env, napi_value value, double_view_t *out) {
  out->data = NULL;
  out->length = 0;
  napi_typedarray_type type;
  size_t length = 0;
  void *data = NULL;
  napi_value arraybuffer;
  size_t byte_offset = 0;
  if (napi_get_typedarray_info(env, value, &type, &length, &data, &arraybuffer, &byte_offset) != napi_ok) {
    return 0;
  }
  if (type != napi_float64_array) return 0;
  out->data = (const double *)data;
  out->length = length;
  return 1;
}

static int get_int32_view(napi_env env, napi_value value, int32_view_t *out) {
  out->data = NULL;
  out->length = 0;
  napi_typedarray_type type;
  size_t length = 0;
  void *data = NULL;
  napi_value arraybuffer;
  size_t byte_offset = 0;
  if (napi_get_typedarray_info(env, value, &type, &length, &data, &arraybuffer, &byte_offset) != napi_ok) {
    return 0;
  }
  if (type != napi_int32_array) return 0;
  out->data = (const int32_t *)data;
  out->length = length;
  return 1;
}

static uint8_view_t *read_uint8_view_array(napi_env env, napi_value array, uint32_t *count_out) {
  uint32_t count = 0;
  if (!get_array_length(env, array, &count)) return NULL;
  uint8_view_t *views = (uint8_view_t *)calloc(count ? count : 1, sizeof(uint8_view_t));
  if (!views) return NULL;
  for (uint32_t index = 0; index < count; index++) {
    napi_value item;
    if (napi_get_element(env, array, index, &item) != napi_ok || !get_uint8_view(env, item, &views[index])) {
      free(views);
      return NULL;
    }
  }
  *count_out = count;
  return views;
}

static output_view_t *read_output_view_array(napi_env env, napi_value array, uint32_t expected_count) {
  uint32_t count = 0;
  if (!get_array_length(env, array, &count) || count < expected_count) return NULL;
  output_view_t *views = (output_view_t *)calloc(expected_count ? expected_count : 1, sizeof(output_view_t));
  if (!views) return NULL;
  for (uint32_t index = 0; index < expected_count; index++) {
    napi_value item;
    if (napi_get_element(env, array, index, &item) != napi_ok || !get_output_view(env, item, &views[index])) {
      free(views);
      return NULL;
    }
  }
  return views;
}

static int64_t floor_i64(double value) {
  int64_t out = (int64_t)value;
  if ((double)out > value) out--;
  return out;
}

static int positive_mod_i64(int64_t value, int side) {
  int out = (int)(value % side);
  return out < 0 ? out + side : out;
}

static int wrapped_texture_index(double value, int side) {
  int64_t index = floor_i64(value);
  if (side > 0 &&
      side <= 0x40000000 &&
      (side & (side - 1)) == 0 &&
      index >= -0x80000000ll &&
      index <= 0x7fffffffll) {
    return ((int32_t)index) & (side - 1);
  }
  return positive_mod_i64(index, side);
}

static int clamp_int(int value, int min_value, int max_value) {
  if (value < min_value) return min_value;
  if (value > max_value) return max_value;
  return value;
}

static double clamp_double(double value, double min_value, double max_value) {
  if (value < min_value) return min_value;
  if (value > max_value) return max_value;
  return value;
}

static double lerp(double a, double b, double t) {
  return a + (b - a) * t;
}

static uint8_t light_sample_byte(const raster_job_t *job, int x, int y) {
  const job_meta_t *meta = job->meta;
  const uint8_view_t *lighting = &job->lightings[meta->lighting_index];
  uint32_t sample_index = (uint32_t)y * meta->light_width + (uint32_t)x;
  uint32_t value = 0;
  for (uint32_t style_index = 0; style_index < meta->style_count; style_index++) {
    size_t offset = (size_t)meta->light_offset + (size_t)style_index * meta->light_sample_count + sample_index;
    value += lighting->data[offset] * meta->style_scales[style_index];
  }
  value >>= 8;
  return (uint8_t)(value > 255u ? 255u : value);
}

static double world_light_at(const raster_job_t *job, double s, double t) {
  const job_meta_t *meta = job->meta;
  const double constant_light = job->doubles[4];
  if (!isnan(constant_light)) return constant_light;

  double sample_s = s / QUAKE_LIGHT_SAMPLE_SIZE - meta->light_min_s;
  double sample_t = t / QUAKE_LIGHT_SAMPLE_SIZE - meta->light_min_t;
  sample_s = (floor_i64(sample_s * VKQUAKE_LIGHTMAP_QUANTIZATION) + 0.5) /
    VKQUAKE_LIGHTMAP_QUANTIZATION;
  sample_t = (floor_i64(sample_t * VKQUAKE_LIGHTMAP_QUANTIZATION) + 0.5) /
    VKQUAKE_LIGHTMAP_QUANTIZATION;

  int x0 = clamp_int((int)floor_i64(sample_s), 0, (int)meta->light_width - 1);
  int y0 = clamp_int((int)floor_i64(sample_t), 0, (int)meta->light_height - 1);
  int x1 = clamp_int(x0 + 1, 0, (int)meta->light_width - 1);
  int y1 = clamp_int(y0 + 1, 0, (int)meta->light_height - 1);
  double fx = clamp_double(sample_s - x0, 0.0, 1.0);
  double fy = clamp_double(sample_t - y0, 0.0, 1.0);
  double top = lerp(light_sample_byte(job, x0, y0), light_sample_byte(job, x1, y0), fx);
  double bottom = lerp(light_sample_byte(job, x0, y1), light_sample_byte(job, x1, y1), fx);
  return (lerp(top, bottom, fy) / 255.0) * VKQUAKE_WORLD_LIGHTMAP_MULTIPLIER;
}

static uint8_t round_light_channel(double value) {
  int rounded = (int)(value + 0.5);
  if (rounded < 0) return 0;
  if (rounded > 255) return 255;
  return (uint8_t)rounded;
}

static int decode_job_meta(const int32_t *meta, job_meta_t *out) {
  if (meta[0] <= 0 || meta[1] <= 0 || meta[2] < 0 || meta[3] <= 0 || meta[4] <= 0) return 0;
  out->width = (uint32_t)meta[0];
  out->height = (uint32_t)meta[1];
  out->texture_index = (uint32_t)meta[2];
  out->texture_width = (uint32_t)meta[3];
  out->texture_height = (uint32_t)meta[4];
  out->lighting_index = meta[5];
  out->light_offset = meta[6];
  out->light_width = meta[7] > 0 ? (uint32_t)meta[7] : 0;
  out->light_height = meta[8] > 0 ? (uint32_t)meta[8] : 0;
  out->light_sample_count = meta[9] > 0 ? (uint32_t)meta[9] : 0;
  out->light_min_s = meta[10];
  out->light_min_t = meta[11];
  if (meta[12] < 0 || meta[12] > 4) return 0;
  out->style_count = (uint32_t)meta[12];
  for (uint32_t index = 0; index < 4; index++) {
    out->style_scales[index] = meta[13 + index] > 0 ? (uint32_t)meta[13 + index] : 0;
  }
  return 1;
}

static int validate_job(const raster_job_t *job, uint32_t texture_count, uint32_t lighting_count) {
  const job_meta_t *meta = job->meta;
  size_t texture_len = (size_t)meta->texture_width * meta->texture_height;
  size_t output_len = (size_t)meta->width * meta->height * 4u;
  if (meta->texture_index >= texture_count) return 0;
  if (job->textures[meta->texture_index].length < texture_len) return 0;
  if (job->palette->length < 256u * 3u || job->lut->length < 256u || job->output->length < output_len) return 0;
  if (!isnan(job->doubles[4])) return 1;
  if (meta->lighting_index < 0 || (uint32_t)meta->lighting_index >= lighting_count) return 0;
  if (meta->light_offset < 0 || !meta->light_width || !meta->light_height || !meta->light_sample_count) return 0;
  if (meta->light_sample_count != meta->light_width * meta->light_height) return 0;
  if (!meta->style_count) return 0;
  size_t needed = (size_t)meta->light_offset + (size_t)meta->style_count * meta->light_sample_count;
  if (job->lightings[meta->lighting_index].length < needed) return 0;
  return 1;
}

static void render_job(const raster_job_t *job) {
  const job_meta_t *meta = job->meta;
  const double *d = job->doubles;
  const double base_tile = d[0];
  const double quake_unit_scale = d[1];
  const double texture_coord_scale_s = d[2];
  const double texture_coord_scale_t = d[3];
  const double constant_light = d[4];
  const int has_constant_light = !isnan(constant_light);
  const double pivot_x = d[5];
  const double pivot_y = d[6];
  const double pivot_z = d[7];
  const double *matrix = d + 8;
  const double *tex_s = d + 24;
  const double *tex_t = d + 28;
  const uint8_view_t *texture = &job->textures[meta->texture_index];
  const uint8_t *texture_data = texture->data;
  const uint8_t *palette = job->palette->data;
  const uint8_t *lut = job->lut->data;
  uint8_t *out = job->output->data;

  for (uint32_t y = 0; y < meta->height; y++) {
    double local_y = y + 0.5;
    double poly_x_local_y = matrix[5] * local_y;
    double poly_y_local_y = matrix[4] * local_y;
    double poly_z_local_y = matrix[6] * local_y;
    for (uint32_t x = 0; x < meta->width; x++) {
      double local_x = x + 0.5;
      uint32_t out_offset = (y * meta->width + x) * 4u;
      double poly_x = (matrix[1] * local_x + poly_x_local_y + matrix[13]) / base_tile;
      double poly_y = (matrix[0] * local_x + poly_y_local_y + matrix[12]) / base_tile;
      double poly_z = (matrix[2] * local_x + poly_z_local_y + matrix[14]) / base_tile;
      double quake_x = poly_x / quake_unit_scale + pivot_x;
      double quake_y = poly_y / quake_unit_scale + pivot_y;
      double quake_z = poly_z / quake_unit_scale + pivot_z;
      double s = quake_x * tex_s[0] + quake_y * tex_s[1] + quake_z * tex_s[2] + tex_s[3];
      double t = quake_x * tex_t[0] + quake_y * tex_t[1] + quake_z * tex_t[2] + tex_t[3];

      int tex_x = wrapped_texture_index(s * texture_coord_scale_s, (int)meta->texture_width);
      int tex_y = wrapped_texture_index(t * texture_coord_scale_t, (int)meta->texture_height);
      uint8_t palette_index = texture_data[(uint32_t)tex_y * meta->texture_width + (uint32_t)tex_x];
      uint32_t palette_offset = palette_index * 3u;
      double light = palette_index >= 224
        ? 1.0
        : has_constant_light
          ? constant_light
          : world_light_at(job, s, t);

      out[out_offset] = lut[round_light_channel(palette[palette_offset] * light)];
      out[out_offset + 1u] = lut[round_light_channel(palette[palette_offset + 1u] * light)];
      out[out_offset + 2u] = lut[round_light_channel(palette[palette_offset + 2u] * light)];
      out[out_offset + 3u] = 255;
    }
  }
}

static napi_value RenderVkQuakeWorldFullCoverageBatch(napi_env env, napi_callback_info info) {
  int timing_enabled = native_raster_timing_enabled();
  uint64_t total_start_ns = timing_enabled ? native_raster_now_ns() : 0;
  size_t argc = 7;
  napi_value args[7];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc < 7) {
    return boolean_value(env, 0);
  }

  double_view_t doubles;
  int32_view_t meta;
  uint8_view_t palette;
  uint8_view_t lut;
  if (!get_double_view(env, args[0], &doubles) ||
      !get_int32_view(env, args[1], &meta) ||
      !get_uint8_view(env, args[4], &palette) ||
      !get_uint8_view(env, args[5], &lut)) {
    return boolean_value(env, 0);
  }
  if (doubles.length % DOUBLE_COUNT || meta.length % META_COUNT) return boolean_value(env, 0);
  uint32_t job_count = (uint32_t)(doubles.length / DOUBLE_COUNT);
  if (meta.length / META_COUNT != job_count) return boolean_value(env, 0);

  uint32_t texture_count = 0;
  uint32_t lighting_count = 0;
  uint8_view_t *textures = read_uint8_view_array(env, args[2], &texture_count);
  uint8_view_t *lightings = read_uint8_view_array(env, args[3], &lighting_count);
  output_view_t *outputs = read_output_view_array(env, args[6], job_count);
  uint64_t setup_done_ns = timing_enabled ? native_raster_now_ns() : 0;
  if (!textures || !lightings || !outputs) {
    free(textures);
    free(lightings);
    free(outputs);
    return boolean_value(env, 0);
  }

  job_meta_t *decoded = (job_meta_t *)calloc(job_count ? job_count : 1, sizeof(job_meta_t));
  if (!decoded) {
    free(textures);
    free(lightings);
    free(outputs);
    return boolean_value(env, 0);
  }

  batch_stats_t stats = {0};
  for (uint32_t job_index = 0; job_index < job_count; job_index++) {
    if (!decode_job_meta(meta.data + (size_t)job_index * META_COUNT, &decoded[job_index])) {
      free(decoded);
      free(textures);
      free(lightings);
      free(outputs);
      return boolean_value(env, 0);
    }
    raster_job_t job;
    job.meta = &decoded[job_index];
    job.doubles = doubles.data + (size_t)job_index * DOUBLE_COUNT;
    job.textures = textures;
    job.lightings = lightings;
    job.palette = &palette;
    job.lut = &lut;
    job.output = &outputs[job_index];
    if (!validate_job(&job, texture_count, lighting_count)) {
      free(decoded);
      free(textures);
      free(lightings);
      free(outputs);
      return boolean_value(env, 0);
    }
    if (timing_enabled) {
      uint64_t pixels = (uint64_t)decoded[job_index].width * decoded[job_index].height;
      if (isnan(doubles.data[(size_t)job_index * DOUBLE_COUNT + 4])) {
        stats.variable_jobs++;
        stats.variable_pixels += pixels;
      } else {
        stats.constant_jobs++;
        stats.constant_pixels += pixels;
      }
    }
  }
  uint64_t validate_done_ns = timing_enabled ? native_raster_now_ns() : 0;

  for (uint32_t job_index = 0; job_index < job_count; job_index++) {
    raster_job_t job;
    job.meta = &decoded[job_index];
    job.doubles = doubles.data + (size_t)job_index * DOUBLE_COUNT;
    job.textures = textures;
    job.lightings = lightings;
    job.palette = &palette;
    job.lut = &lut;
    job.output = &outputs[job_index];
    uint64_t job_start_ns = timing_enabled ? native_raster_now_ns() : 0;
    render_job(&job);
    if (timing_enabled) {
      uint64_t job_ns = native_raster_now_ns() - job_start_ns;
      if (isnan(job.doubles[4])) {
        stats.variable_render_ns += job_ns;
      } else {
        stats.constant_render_ns += job_ns;
      }
    }
  }
  uint64_t render_done_ns = timing_enabled ? native_raster_now_ns() : 0;

  if (timing_enabled) {
    uint64_t setup_ns = setup_done_ns - total_start_ns;
    uint64_t validate_ns = validate_done_ns - setup_done_ns;
    uint64_t render_ns = render_done_ns - validate_done_ns;
    uint64_t total_ns = render_done_ns - total_start_ns;
    fprintf(
      stderr,
      "Native vkQuake batch raster: jobs=%u px=%llu constant=%u/%llu variable=%u/%llu "
      "setup=%.3fms validate=%.3fms render=%.3fms total=%.3fms "
      "constantRender=%.3fms variableRender=%.3fms\n",
      job_count,
      (unsigned long long)(stats.constant_pixels + stats.variable_pixels),
      stats.constant_jobs,
      (unsigned long long)stats.constant_pixels,
      stats.variable_jobs,
      (unsigned long long)stats.variable_pixels,
      native_raster_ns_to_ms(setup_ns),
      native_raster_ns_to_ms(validate_ns),
      native_raster_ns_to_ms(render_ns),
      native_raster_ns_to_ms(total_ns),
      native_raster_ns_to_ms(stats.constant_render_ns),
      native_raster_ns_to_ms(stats.variable_render_ns)
    );
  }

  free(decoded);
  free(textures);
  free(lightings);
  free(outputs);
  return boolean_value(env, 1);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(
    env,
    "renderVkQuakeWorldFullCoverageBatch",
    NAPI_AUTO_LENGTH,
    RenderVkQuakeWorldFullCoverageBatch,
    NULL,
    &fn
  );
  napi_set_named_property(env, exports, "renderVkQuakeWorldFullCoverageBatch", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
