<?php
/**
 * Plugin Name: OpenFlow Form Embed
 * Plugin URI: https://github.com/your-org/openflow
 * Description: Embed OpenFlow lead generation forms via shortcode or WPBakery element. Connect to your self-hosted OpenFlow instance.
 * Version: 1.0.0
 * Author: OpenFlow
 * License: MIT
 * Text Domain: openflow
 */

if (!defined('ABSPATH')) exit;

define('OPENFLOW_VERSION', '1.0.0');
define('OPENFLOW_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('OPENFLOW_PLUGIN_URL', plugin_dir_url(__FILE__));

// =============================================
// Plugin Initialization
// =============================================

add_action('admin_menu', 'openflow_register_settings_page');
add_action('admin_init', 'openflow_register_settings');
add_shortcode('openflow', 'openflow_shortcode_handler');
add_action('vc_before_init', 'openflow_register_wpbakery_element');
add_action('init', 'openflow_register_gutenberg_block');

// =============================================
// Settings Management
// =============================================

function openflow_register_settings_page(): void
{
    add_options_page(
        'OpenFlow Settings',
        'OpenFlow',
        'manage_options',
        'openflow-settings',
        'openflow_render_settings_page'
    );
}

function openflow_register_settings(): void
{
    register_setting('openflow_settings', 'openflow_server_url', [
        'sanitize_callback' => 'openflow_sanitize_server_url',
        'default' => '',
    ]);

    register_setting('openflow_settings', 'openflow_default_height', [
        'sanitize_callback' => 'absint',
        'default' => 600,
    ]);

    add_settings_section('openflow_main', 'Server Connection', null, 'openflow-settings');

    add_settings_field(
        'openflow_server_url',
        'OpenFlow Server URL',
        'openflow_render_server_url_field',
        'openflow-settings',
        'openflow_main'
    );

    add_settings_field(
        'openflow_default_height',
        'Default iFrame Height (px)',
        'openflow_render_height_field',
        'openflow-settings',
        'openflow_main'
    );
}

function openflow_sanitize_server_url(string $val): string
{
    return rtrim(esc_url_raw($val), '/');
}

function openflow_render_server_url_field(): void
{
    $val = get_option('openflow_server_url', '');
    echo '<input type="url" name="openflow_server_url" value="' . esc_attr($val) . '" class="regular-text" placeholder="https://forms.example.com" />';
    echo '<p class="description">The base URL of your OpenFlow server installation.</p>';
}

function openflow_render_height_field(): void
{
    $val = get_option('openflow_default_height', 600);
    echo '<input type="number" name="openflow_default_height" value="' . esc_attr($val) . '" min="200" max="2000" />';
}

function openflow_render_settings_page(): void
{
    ?>
    <div class="wrap">
        <h1>OpenFlow Settings</h1>
        <form method="post" action="options.php">
            <?php
            settings_fields('openflow_settings');
            do_settings_sections('openflow-settings');
            submit_button();
            ?>
        </form>
        <hr />
        <h2>Usage</h2>
        <h3>Shortcode</h3>
        <code>[openflow slug="your-form-slug"]</code>
        <p>Optional attributes: <code>height="600"</code>, <code>autoresize="true"</code></p>
        <h3>WPBakery</h3>
        <p>Use the "OpenFlow Form" element in WPBakery Page Builder.</p>
    </div>
    <?php
}

// =============================================
// Shortcode Handler
// =============================================

function openflow_shortcode_handler(array $atts): string
{
    $atts = shortcode_atts([
        'slug'       => '',
        'height'     => get_option('openflow_default_height', 600),
        'autoresize' => 'true',
    ], $atts, 'openflow');

    if (empty($atts['slug'])) {
        return '<!-- OpenFlow: No form slug provided -->';
    }

    $server_url = get_option('openflow_server_url', '');
    if (empty($server_url)) {
        return '<!-- OpenFlow: Server URL not configured. Go to Settings > OpenFlow -->';
    }

    return openflow_generate_embed_html($atts, $server_url);
}

function openflow_generate_embed_html(array $atts, string $server_url): string
{
    $slug = sanitize_text_field($atts['slug']);
    $height = absint($atts['height']);
    $autoresize = $atts['autoresize'] === 'true';
    $id = 'openflow-' . esc_attr($slug) . '-' . wp_rand(1000, 9999);
    $src = esc_url($server_url . '/embed/' . $slug);

    $iframe = sprintf(
        '<iframe id="%s" src="%s" width="100%%" height="%d" frameborder="0" style="border:none;border-radius:12px;" loading="lazy" allow="clipboard-write"></iframe>',
        $id,
        $src,
        $height
    );

    if ($autoresize) {
        $iframe .= sprintf(
            '<script>window.addEventListener("message",function(e){if(e.data&&e.data.type==="openflow-resize"){document.getElementById("%s").style.height=e.data.height+"px";}});</script>',
            $id
        );
    }

    return $iframe;
}

// =============================================
// WPBakery Integration
// =============================================

function openflow_register_wpbakery_element(): void
{
    if (!function_exists('vc_map')) {
        return;
    }

    vc_map([
        'name'        => 'OpenFlow Form',
        'base'        => 'openflow',
        'category'    => 'Content',
        'description' => 'Embed an OpenFlow lead generation form',
        'icon'        => 'dashicons dashicons-feedback',
        'params'      => [
            [
                'type'        => 'textfield',
                'heading'     => 'Form Slug',
                'param_name'  => 'slug',
                'description' => 'The slug/ID of your OpenFlow form (found in the Embed tab).',
                'admin_label' => true,
            ],
            [
                'type'        => 'textfield',
                'heading'     => 'Height (px)',
                'param_name'  => 'height',
                'value'       => '600',
                'description' => 'Initial iframe height in pixels.',
            ],
            [
                'type'        => 'dropdown',
                'heading'     => 'Auto-Resize',
                'param_name'  => 'autoresize',
                'value'       => [
                    'Yes' => 'true',
                    'No'  => 'false',
                ],
                'description' => 'Automatically adjust height based on form content.',
            ],
        ],
    ]);
}

// =============================================
// Gutenberg Block
// =============================================

function openflow_register_gutenberg_block(): void
{
    if (!function_exists('register_block_type')) {
        return;
    }

    wp_register_script(
        'openflow-block',
        OPENFLOW_PLUGIN_URL . 'block.js',
        ['wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components'],
        OPENFLOW_VERSION
    );

    register_block_type('openflow/form', [
        'editor_script'   => 'openflow-block',
        'render_callback' => 'openflow_gutenberg_render_callback',
        'attributes'      => [
            'slug'       => ['type' => 'string', 'default' => ''],
            'height'     => ['type' => 'number', 'default' => 600],
            'autoresize' => ['type' => 'boolean', 'default' => true],
        ],
    ]);
}

function openflow_gutenberg_render_callback(array $atts): string
{
    return do_shortcode(sprintf(
        '[openflow slug="%s" height="%s" autoresize="%s"]',
        sanitize_text_field($atts['slug'] ?? ''),
        absint($atts['height'] ?? 600),
        ($atts['autoresize'] ?? true) ? 'true' : 'false'
    ));
}
