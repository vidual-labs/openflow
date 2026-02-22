(function () {
  const { registerBlockType } = wp.blocks;
  const { TextControl, ToggleControl, PanelBody } = wp.components;
  const { InspectorControls, useBlockProps } = wp.blockEditor;
  const { createElement: el, Fragment } = wp.element;

  const blockConfig = {
    title: 'OpenFlow Form',
    icon: 'feedback',
    category: 'embed',
    description: 'Embed an OpenFlow lead generation form',

    attributes: {
      slug: { type: 'string', default: '' },
      height: { type: 'number', default: 600 },
      autoresize: { type: 'boolean', default: true },
    },
  };

  function renderInspectorControls (attributes, setAttributes) {
    return el(PanelBody, { title: 'Form Settings', initialOpen: true },
      el(TextControl, {
        label: 'Form Slug',
        value: attributes.slug,
        onChange: (val) => setAttributes({ slug: val }),
        help: 'Found in your OpenFlow admin under Embed tab.',
      }),
      el(TextControl, {
        label: 'Height (px)',
        type: 'number',
        value: String(attributes.height),
        onChange: (val) => setAttributes({ height: parseInt(val) || 600 }),
      }),
      el(ToggleControl, {
        label: 'Auto-Resize',
        checked: attributes.autoresize,
        onChange: (val) => setAttributes({ autoresize: val }),
      })
    );
  }

  function renderBlockPlaceholder (slug) {
    return el('div', {
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
      el('span', { style: { color: '#666' } }, 'Slug: ' + slug),
      el('br'),
      el('span', { style: { color: '#999', fontSize: '12px' } }, 'Form will render on the frontend')
    );
  }

  function renderEmptyState () {
    return el('div', {
      style: {
        background: '#fff3cd',
        border: '1px solid #ffc107',
        borderRadius: '8px',
        padding: '20px',
        textAlign: 'center',
      },
    }, 'Please enter a form slug in the block settings.');
  }

  registerBlockType('openflow/form', {
    ...blockConfig,

    edit (props) {
      const { attributes, setAttributes } = props;
      const blockProps = useBlockProps();

      return el(Fragment, null,
        el(InspectorControls, null, renderInspectorControls(attributes, setAttributes)),
        el('div', blockProps, attributes.slug ? renderBlockPlaceholder(attributes.slug) : renderEmptyState())
      );
    },

    save () {
      return null;
    },
  });
})();
