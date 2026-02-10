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

// ──────────────────────────────────────────
// Settings Page
// ──────────────────────────────────────────

add_action('admin_menu', function () {
    add_options_page(
        'OpenFlow Settings',
        'OpenFlow',
        'manage_options',
        'openflow-settings',
        'openflow_settings_page'
    );
});

add_action('admin_init', function () {
    register_setting('openflow_settings', 'openflow_server_url', [
        'sanitize_callback' => function ($val) {
            return rtrim(esc_url_raw($val), '/');
        },
    ]);
    register_setting('openflow_settings', 'openflow_default_height', [
        'sanitize_callback' => 'absint',
        'default' => 600,
    ]);

    add_settings_section('openflow_main', 'Server Connection', null, 'openflow-settings');

    add_settings_field('openflow_server_url', 'OpenFlow Server URL', function () {
        $val = get_option('openflow_server_url', '');
        echo '<input type="url" name="openflow_server_url" value="' . esc_attr($val) . '" class="regular-text" placeholder="https://forms.example.com" />';
        echo '<p class="description">The base URL of your OpenFlow server installation.</p>';
    }, 'openflow-settings', 'openflow_main');

    add_settings_field('openflow_default_height', 'Default iFrame Height (px)', function () {
        $val = get_option('openflow_default_height', 600);
        echo '<input type="number" name="openflow_default_height" value="' . esc_attr($val) . '" min="200" max="2000" />';
    }, 'openflow-settings', 'openflow_main');
});

function openflow_settings_page() {
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

// ──────────────────────────────────────────
// Shortcode: [openflow slug="xxx"]
// ──────────────────────────────────────────

add_shortcode('openflow', function ($atts) {
    $atts = shortcode_atts([
        'slug'       => '',
        'height'     => get_option('openflow_default_height', 600),
        'autoresize' => 'true',
    ], $atts, 'openflow');

    if (empty($atts['slug'])) {
        return '<!-- OpenFlow: No form slug provided -->';
    }

    $server = get_option('openflow_server_url', '');
    if (empty($server)) {
        return '<!-- OpenFlow: Server URL not configured. Go to Settings > OpenFlow -->';
    }

    $slug = sanitize_text_field($atts['slug']);
    $height = absint($atts['height']);
    $autoresize = $atts['autoresize'] === 'true';
    $id = 'openflow-' . esc_attr($slug) . '-' . wp_rand(1000, 9999);
    $src = esc_url($server . '/embed/' . $slug);

    $html = sprintf(
        '<iframe id="%s" src="%s" width="100%%" height="%d" frameborder="0" style="border:none;border-radius:12px;" loading="lazy" allow="clipboard-write"></iframe>',
        $id,
        $src,
        $height
    );

    if ($autoresize) {
        $html .= sprintf(
            '<script>window.addEventListener("message",function(e){if(e.data&&e.data.type==="openflow-resize"){document.getElementById("%s").style.height=e.data.height+"px";}});</script>',
            $id
        );
    }

    return $html;
});

// ──────────────────────────────────────────
// WPBakery Integration
// ──────────────────────────────────────────

add_action('vc_before_init', function () {
    if (!function_exists('vc_map')) return;

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
});

// ──────────────────────────────────────────
// Gutenberg Block (optional bonus)
// ──────────────────────────────────────────

add_action('init', function () {
    if (!function_exists('register_block_type')) return;

    wp_register_script(
        'openflow-block',
        OPENFLOW_PLUGIN_URL . 'block.js',
        ['wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components'],
        OPENFLOW_VERSION
    );

    register_block_type('openflow/form', [
        'editor_script'   => 'openflow-block',
        'render_callback' => function ($atts) {
            return do_shortcode(sprintf(
                '[openflow slug="%s" height="%s" autoresize="%s"]',
                sanitize_text_field($atts['slug'] ?? ''),
                absint($atts['height'] ?? 600),
                ($atts['autoresize'] ?? true) ? 'true' : 'false'
            ));
        },
        'attributes'      => [
            'slug'       => ['type' => 'string', 'default' => ''],
            'height'     => ['type' => 'number', 'default' => 600],
            'autoresize' => ['type' => 'boolean', 'default' => true],
        ],
    ]);
});
