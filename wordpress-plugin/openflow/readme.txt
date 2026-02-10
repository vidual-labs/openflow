=== OpenFlow Form Embed ===
Contributors: openflow
Tags: forms, lead generation, typeform, embed, iframe
Requires at least: 5.0
Tested up to: 6.7
Stable tag: 1.0.0
Requires PHP: 7.4
License: MIT

Embed OpenFlow lead generation forms in WordPress via shortcode, WPBakery element, or Gutenberg block.

== Description ==

OpenFlow Form Embed connects your WordPress site to your self-hosted OpenFlow form builder instance. Embed beautiful, multi-step lead generation forms anywhere on your site.

**Features:**
* Shortcode support: `[openflow slug="your-form-slug"]`
* WPBakery Page Builder element
* Gutenberg block
* Auto-resize iframe
* Configurable height
* Works with any OpenFlow server installation

== Installation ==

1. Upload the `openflow` folder to `/wp-content/plugins/`
2. Activate the plugin in WordPress
3. Go to **Settings > OpenFlow** and enter your OpenFlow server URL
4. Use `[openflow slug="your-form-slug"]` in any page or post

== Usage ==

= Shortcode =
`[openflow slug="abc123" height="600" autoresize="true"]`

= WPBakery =
Add the "OpenFlow Form" element from the Content category.

= Gutenberg =
Search for "OpenFlow Form" in the block inserter.

== Changelog ==

= 1.0.0 =
* Initial release
* Shortcode, WPBakery, and Gutenberg support
* Auto-resize iframe
* Settings page for server URL configuration
