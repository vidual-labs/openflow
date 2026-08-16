jest.mock('../src/utils/ssrf', () => ({ assertSafeUrl: jest.fn().mockResolvedValue(undefined) }));

const { assertSafeUrl } = require('../src/utils/ssrf');
const { fetchCalonAvailability } = require('../src/models/calon');

describe('fetchCalonAvailability', () => {
  afterEach(() => {
    delete global.fetch;
    assertSafeUrl.mockClear();
    assertSafeUrl.mockResolvedValue(undefined);
  });

  it('builds the request from resource_slug/from/to/duration_min and returns timezone + slots', async () => {
    const slots = [{ start: '2026-09-02T09:00:00+02:00', end: '2026-09-02T09:30:00+02:00', timezone: 'Europe/Berlin' }];
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ timezone: 'Europe/Berlin', slots }),
    });

    const result = await fetchCalonAvailability({
      baseUrl: 'https://calon.example.com',
      resourceSlug: 'default',
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-08T00:00:00Z',
      durationMin: 45,
    });

    expect(result).toEqual({ timezone: 'Europe/Berlin', slots });
    expect(assertSafeUrl).toHaveBeenCalledTimes(1);

    const calledUrl = new URL(global.fetch.mock.calls[0][0]);
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://calon.example.com/api/v1/availability');
    expect(calledUrl.searchParams.get('resource_slug')).toBe('default');
    expect(calledUrl.searchParams.get('from')).toBe('2026-09-01T00:00:00Z');
    expect(calledUrl.searchParams.get('to')).toBe('2026-09-08T00:00:00Z');
    expect(calledUrl.searchParams.get('duration_min')).toBe('45');
    expect(global.fetch.mock.calls[0][1].redirect).toBe('manual');
  });

  it('defaults resource_slug to "default" and omits duration_min when not given', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ timezone: 'UTC', slots: [] }) });
    await fetchCalonAvailability({ baseUrl: 'https://calon.example.com', from: 'a', to: 'b' });
    const calledUrl = new URL(global.fetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('resource_slug')).toBe('default');
    expect(calledUrl.searchParams.has('duration_min')).toBe(false);
  });

  it('rejects a redirect response rather than following it', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 302, ok: false });
    await expect(
      fetchCalonAvailability({ baseUrl: 'https://calon.example.com', from: 'a', to: 'b' })
    ).rejects.toThrow(/redirect/);
  });

  it('rejects a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 500, ok: false });
    await expect(
      fetchCalonAvailability({ baseUrl: 'https://calon.example.com', from: 'a', to: 'b' })
    ).rejects.toThrow(/500/);
  });

  it('rejects a response whose body has no slots array', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ timezone: 'UTC' }) });
    await expect(
      fetchCalonAvailability({ baseUrl: 'https://calon.example.com', from: 'a', to: 'b' })
    ).rejects.toThrow(/Unexpected response/);
  });

  it('propagates the SSRF guard rejection for an unsafe base URL, without ever fetching', async () => {
    assertSafeUrl.mockRejectedValueOnce(new Error('This URL resolves to a private/internal address and cannot be used'));
    global.fetch = jest.fn();
    await expect(
      fetchCalonAvailability({ baseUrl: 'http://169.254.169.254', from: 'a', to: 'b' })
    ).rejects.toThrow(/private\/internal/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
