const dns = require('dns').promises;
const { assertSafeUrl, parseHostList } = require('../src/utils/ssrf');

// Resolve names from a fixed table instead of real DNS.
const TABLE = {
  'calon': [{ address: '172.18.0.5', family: 4 }],
  'calon.internal': [{ address: '10.0.0.7', family: 4 }],
  'localhost': [{ address: '127.0.0.1', family: 4 }],
  'metadata.internal': [{ address: '169.254.169.254', family: 4 }],
  'public.example.com': [{ address: '93.184.216.34', family: 4 }],
};

beforeEach(() => {
  jest.spyOn(dns, 'lookup').mockImplementation(async (host) => {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return [{ address: host, family: 4 }];
    if (host.includes(':')) return [{ address: host, family: 6 }];
    if (TABLE[host]) return TABLE[host];
    throw new Error('ENOTFOUND');
  });
});
afterEach(() => jest.restoreAllMocks());

describe('assertSafeUrl', () => {
  it('allows a public host', async () => {
    await expect(assertSafeUrl('https://public.example.com/x')).resolves.toBeUndefined();
  });

  it.each([
    'http://localhost:8000/api/v1/availability',
    'http://127.0.0.1:8000/',
    'http://calon:8000/',
    'http://10.0.0.7/',
    'http://[::1]:8000/',
    'http://169.254.169.254/latest/meta-data/',
  ])('blocks %s by default', async (url) => {
    await expect(assertSafeUrl(url)).rejects.toThrow();
  });

  it('an empty allow-list changes nothing', async () => {
    await expect(assertSafeUrl('http://localhost:8000/', { allowHosts: '' })).rejects.toThrow(/localhost/);
    await expect(assertSafeUrl('http://calon:8000/', { allowHosts: undefined })).rejects.toThrow(/private/);
  });

  describe('with allowHosts', () => {
    it('allows a listed host:port, and only on that port', async () => {
      await expect(assertSafeUrl('http://calon:8000/api/v1/bookings', { allowHosts: 'calon:8000' })).resolves.toBeUndefined();
      await expect(assertSafeUrl('http://calon:8001/', { allowHosts: 'calon:8000' })).rejects.toThrow(/private/);
      await expect(assertSafeUrl('http://calon/', { allowHosts: 'calon:8000' })).rejects.toThrow(/private/);
    });

    it('allows a listed host without a port on any port', async () => {
      await expect(assertSafeUrl('http://calon.internal:9000/', { allowHosts: 'calon.internal' })).resolves.toBeUndefined();
      await expect(assertSafeUrl('https://calon.internal/', { allowHosts: 'calon.internal' })).resolves.toBeUndefined();
    });

    it('uses the scheme default port when the URL has none', async () => {
      await expect(assertSafeUrl('http://calon/', { allowHosts: 'calon:80' })).resolves.toBeUndefined();
      await expect(assertSafeUrl('https://calon/', { allowHosts: 'calon:443' })).resolves.toBeUndefined();
      await expect(assertSafeUrl('https://calon/', { allowHosts: 'calon:80' })).rejects.toThrow();
    });

    it('allows localhost and IP literals when listed, case-insensitively', async () => {
      const allowHosts = ' LocalHost:8000 , 127.0.0.1:8000,[::1]:8000';
      await expect(assertSafeUrl('http://localhost:8000/', { allowHosts })).resolves.toBeUndefined();
      await expect(assertSafeUrl('http://127.0.0.1:8000/', { allowHosts })).resolves.toBeUndefined();
      await expect(assertSafeUrl('http://[::1]:8000/', { allowHosts })).resolves.toBeUndefined();
    });

    it('does not allow anything else', async () => {
      await expect(assertSafeUrl('http://10.0.0.7/', { allowHosts: 'calon:8000' })).rejects.toThrow(/private/);
      await expect(assertSafeUrl('http://localhost:8000/', { allowHosts: 'calon:8000' })).rejects.toThrow(/localhost/);
    });

    it('never allows link-local / cloud metadata addresses, even when listed', async () => {
      await expect(assertSafeUrl('http://169.254.169.254/', { allowHosts: '169.254.169.254' })).rejects.toThrow(/link-local/);
      await expect(assertSafeUrl('http://metadata.internal/', { allowHosts: 'metadata.internal' })).rejects.toThrow(/link-local/);
      await expect(assertSafeUrl('http://0.0.0.0:8000/', { allowHosts: '0.0.0.0:8000' })).rejects.toThrow(/link-local/);
      await expect(assertSafeUrl('http://[fe80::1]/', { allowHosts: 'fe80::1' })).rejects.toThrow(/link-local/);
    });

    it('still requires http(s) and a resolvable host', async () => {
      await expect(assertSafeUrl('ftp://calon:8000/', { allowHosts: 'calon:8000' })).rejects.toThrow(/http/);
      await expect(assertSafeUrl('http://nowhere:8000/', { allowHosts: 'nowhere:8000' })).rejects.toThrow(/resolve/);
    });
  });
});

describe('parseHostList', () => {
  it('parses host and host:port entries, ignoring blanks and malformed ports', () => {
    expect(parseHostList(' calon:8000, ,Calon.Internal,[::1]:8000, fe80::1 , bad:port, x:70000 ')).toEqual([
      { host: 'calon', port: 8000 },
      { host: 'calon.internal', port: null },
      { host: '::1', port: 8000 },
      { host: 'fe80::1', port: null },
    ]);
  });

  it('is empty for an unset value', () => {
    expect(parseHostList(undefined)).toEqual([]);
    expect(parseHostList('')).toEqual([]);
  });
});
