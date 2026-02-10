(function () {
  const { registerBlockType } = wp.blocks;
  const { TextControl, ToggleControl, PanelBody } = wp.components;
  const { InspectorControls, useBlockProps } = wp.blockEditor;
  const { createElement: el, Fragment } = wp.element;

  registerBlockType('openflow/form', {
    title: 'OpenFlow Form',
    icon: 'feedback',
    category: 'embed',
    description: 'Embed an OpenFlow lead generation form',

    attributes: {
      slug: { type: 'string', default: '' },
      height: { type: 'number', default: 600 },
      autoresize: { type: 'boolean', default: true },
    },

    edit: function (props) {
      const { attributes, setAttributes } = props;
      const blockProps = useBlockProps();

      return el(Fragment, null,
        el(InspectorControls, null,
          el(PanelBody, { title: 'Form Settings', initialOpen: true },
            el(TextControl, {
              label: 'Form Slug',
              value: attributes.slug,
              onChange: function (val) { setAttributes({ slug: val }); },
              help: 'Found in your OpenFlow admin under Embed tab.',
            }),
            el(TextControl, {
              label: 'Height (px)',
              type: 'number',
              value: String(attributes.height),
              onChange: function (val) { setAttributes({ height: parseInt(val) || 600 }); },
            }),
            el(ToggleControl, {
              label: 'Auto-Resize',
              checked: attributes.autoresize,
              onChange: function (val) { setAttributes({ autoresize: val }); },
            })
          )
        ),
        el('div', blockProps,
          attributes.slug
            ? el('div', {
                style: {
                  background: '#f0f0f0',
                  border: '2px dashed #6C5CE7',
                  borderRadius: '12px',
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: '#333',
                },
              },
                el('strong', { style: { fontSize: '16px' } }, 'OpenFlow Form'),
                el('br'),
                el('span', { style: { color: '#666' } }, 'Slug: ' + attributes.slug),
                el('br'),
                el('span', { style: { color: '#999', fontSize: '12px' } }, 'Form will render on the frontend')
              )
            : el('div', {
                style: {
                  background: '#fff3cd',
                  border: '1px solid #ffc107',
                  borderRadius: '8px',
                  padding: '20px',
                  textAlign: 'center',
                },
              }, 'Please enter a form slug in the block settings.')
        )
      );
    },

    save: function () {
      return null; // Server-side render
    },
  });
})();
