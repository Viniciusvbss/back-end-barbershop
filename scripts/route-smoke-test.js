const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

const state = {
  token: '',
  barbershop: null,
  service: null,
  barber: null,
  customer: null,
  appointment: null,
  privacyRequest: null,
};

const results = [];

const svgBlob = () => new Blob([
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#C9A84C"/></svg>',
], { type: 'image/svg+xml' });

const request = async (method, path, {
  body,
  token = state.token,
  formData,
  expected = [200],
} = {}) => {
  const headers = {};
  const options = { method, headers };

  if (token) headers.Authorization = `Bearer ${token}`;

  if (formData) {
    options.body = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, options);
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!expected.includes(response.status)) {
    const error = new Error(`${method} ${path} returned ${response.status}`);
    error.data = data;
    throw error;
  }

  return { status: response.status, data };
};

const test = async (name, fn) => {
  try {
    const details = await fn();
    results.push({ name, ok: true, details });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, details: error.data || error.message });
    console.log(`FAIL ${name}: ${error.message}`);
    if (error.data) console.log(JSON.stringify(error.data));
  }
};

const run = async () => {
  const stamp = Date.now();
  const slug = `lgpd-test-${stamp}`;
  const email = `lgpd-test-${stamp}@example.com`;
  const password = 'Teste123!';

  await test('GET /', async () => request('GET', '/', { token: '' }));
  await test('GET /api/privacy/metadata', async () => request('GET', '/api/privacy/metadata', { token: '' }));

  await test('POST /api/barbershops', async () => {
    const { data } = await request('POST', '/api/barbershops', {
      token: '',
      body: {
        name: `LGPD Test ${stamp}`,
        slug,
        phone: '(85) 99999-0000',
        email,
        password,
        privacy_policy_accepted: true,
        terms_accepted: true,
      },
      expected: [201],
    });
    state.barbershop = data;
    return { id: data.id, slug: data.slug };
  });

  await test('POST /api/auth/login', async () => {
    const { data } = await request('POST', '/api/auth/login', {
      token: '',
      body: { email, password, rememberMe: false },
    });
    state.token = data.token;
    return { token: !!data.token };
  });

  await test('POST /api/auth/forgot-password', async () => request('POST', '/api/auth/forgot-password', {
    token: '',
    body: { email },
  }));

  await test('POST /api/auth/reset-password invalid token', async () => request('POST', '/api/auth/reset-password', {
    token: '',
    body: { token: 'invalid-token', password: 'Nova123!', confirmPassword: 'Nova123!' },
    expected: [400],
  }));

  await test('GET /api/barbershops', async () => request('GET', '/api/barbershops', { token: '' }));
  await test('GET /api/barbershops/slug/:slug', async () => request('GET', `/api/barbershops/slug/${slug}`, { token: '' }));
  await test('GET /api/barbershops/:id', async () => request('GET', `/api/barbershops/${state.barbershop.id}`));
  await test('PUT /api/barbershops/:id', async () => request('PUT', `/api/barbershops/${state.barbershop.id}`, {
    body: { name: `${state.barbershop.name} Atualizada` },
  }));

  await test('POST /api/barbershops/:id/logo', async () => {
    const form = new FormData();
    form.append('logo', svgBlob(), 'logo.svg');
    return request('POST', `/api/barbershops/${state.barbershop.id}/logo`, { formData: form });
  });
  await test('DELETE /api/barbershops/:id/logo', async () => request('DELETE', `/api/barbershops/${state.barbershop.id}/logo`));

  await test('GET /api/services/public/:slug empty', async () => request('GET', `/api/services/public/${slug}`, { token: '' }));
  await test('POST /api/services', async () => {
    const { data } = await request('POST', '/api/services', {
      body: { name: 'Corte Teste', duration_minutes: 30, price: 50 },
      expected: [201],
    });
    state.service = data;
    return { id: data.id };
  });
  await test('GET /api/services', async () => request('GET', '/api/services'));
  await test('GET /api/services/:id', async () => request('GET', `/api/services/${state.service.id}`));
  await test('PUT /api/services/:id', async () => request('PUT', `/api/services/${state.service.id}`, {
    body: { name: 'Corte Teste Atualizado', duration_minutes: 35, price: 55 },
  }));
  await test('GET /api/services/public/:slug', async () => request('GET', `/api/services/public/${slug}`, { token: '' }));

  await test('GET /api/barbers/public/:slug empty', async () => request('GET', `/api/barbers/public/${slug}`, { token: '' }));
  await test('POST /api/barbers', async () => {
    const form = new FormData();
    form.append('name', 'Barbeiro Teste');
    form.append('phone', '(85) 98888-0000');
    form.append('image', svgBlob(), 'barber.svg');
    const { data } = await request('POST', '/api/barbers', { formData: form, expected: [201] });
    state.barber = data;
    return { id: data.id };
  });
  await test('GET /api/barbers', async () => request('GET', '/api/barbers'));
  await test('GET /api/barbers/:id', async () => request('GET', `/api/barbers/${state.barber.id}`));
  await test('PUT /api/barbers/:id', async () => {
    const form = new FormData();
    form.append('name', 'Barbeiro Teste Atualizado');
    form.append('phone', '(85) 97777-0000');
    return request('PUT', `/api/barbers/${state.barber.id}`, { formData: form });
  });
  await test('GET /api/barbers/public/:slug', async () => request('GET', `/api/barbers/public/${slug}`, { token: '' }));

  await test('GET /api/business-hours/public/:slug empty', async () => request('GET', `/api/business-hours/public/${slug}`, { token: '' }));
  await test('POST /api/business-hours', async () => {
    const { data } = await request('POST', '/api/business-hours', {
      body: { weekday: 1, open_time: '09:00', close_time: '18:00' },
      expected: [201],
    });
    state.businessHour = data;
    return { id: data.id };
  });
  await test('GET /api/business-hours', async () => request('GET', '/api/business-hours'));
  await test('GET /api/business-hours/:id', async () => request('GET', `/api/business-hours/${state.businessHour.id}`));
  await test('PUT /api/business-hours/:id', async () => request('PUT', `/api/business-hours/${state.businessHour.id}`, {
    body: { weekday: 1, open_time: '10:00', close_time: '19:00' },
  }));
  await test('GET /api/business-hours/public/:slug', async () => request('GET', `/api/business-hours/public/${slug}`, { token: '' }));

  await test('POST /api/customers', async () => {
    const { data } = await request('POST', '/api/customers', {
      body: {
        name: 'Cliente Teste',
        phone: '(85) 96666-0000',
        email: `cliente-${stamp}@example.com`,
        marketing_consent: true,
      },
      expected: [201],
    });
    state.customer = data;
    return { id: data.id };
  });
  await test('GET /api/customers', async () => request('GET', '/api/customers'));
  await test('GET /api/customers/:id', async () => request('GET', `/api/customers/${state.customer.id}`));
  await test('PUT /api/customers/:id', async () => request('PUT', `/api/customers/${state.customer.id}`, {
    body: {
      name: 'Cliente Teste Atualizado',
      phone: '(85) 95555-0000',
      email: `cliente-atualizado-${stamp}@example.com`,
      marketing_consent: false,
    },
  }));
  await test('GET /api/customers/:id/export', async () => request('GET', `/api/customers/${state.customer.id}/export`));

  await test('POST /api/appointments', async () => {
    const { data } = await request('POST', '/api/appointments', {
      body: {
        barber_id: state.barber.id,
        customer_id: state.customer.id,
        service_id: state.service.id,
        appointment_date: '2030-01-15',
        appointment_time: '10:00',
      },
      expected: [201],
    });
    state.appointment = data;
    return { id: data.id };
  });
  await test('GET /api/appointments', async () => request('GET', '/api/appointments'));
  await test('GET /api/appointments/:id', async () => request('GET', `/api/appointments/${state.appointment.id}`));
  await test('PATCH /api/appointments/:id/status', async () => request('PATCH', `/api/appointments/${state.appointment.id}/status`, {
    body: { status: 'confirmed' },
  }));
  await test('GET /api/appointments/public/:slug', async () => request('GET', `/api/appointments/public/${slug}?date=2030-01-15`, { token: '' }));
  await test('POST /api/appointments/public/:slug', async () => {
    const { data } = await request('POST', `/api/appointments/public/${slug}`, {
      token: '',
      body: {
        barber_id: state.barber.id,
        service_id: state.service.id,
        appointment_date: '2030-01-16',
        appointment_time: '11:00',
        customer_name: 'Cliente Publico',
        customer_phone: '(85) 94444-0000',
        customer_email: `publico-${stamp}@example.com`,
        privacy_policy_accepted: true,
        marketing_consent: true,
      },
      expected: [201],
    });
    state.publicAppointment = data;
    return { id: data.id };
  });

  await test('POST /api/privacy/requests', async () => {
    const { data } = await request('POST', '/api/privacy/requests', {
      token: '',
      body: {
        barbershop_id: state.barbershop.id,
        request_type: 'access',
        requester_name: 'Cliente Teste',
        requester_email: `cliente-${stamp}@example.com`,
        description: 'Solicito acesso aos meus dados.',
      },
      expected: [201],
    });
    state.privacyRequest = data;
    return { id: data.id };
  });
  await test('GET /api/privacy/requests', async () => request('GET', '/api/privacy/requests'));
  await test('PATCH /api/privacy/requests/:id/status', async () => request('PATCH', `/api/privacy/requests/${state.privacyRequest.id}/status`, {
    body: { status: 'resolved', resolution_note: 'Atendida no teste automatizado.' },
  }));

  await test('DELETE /api/appointments/:id', async () => request('DELETE', `/api/appointments/${state.appointment.id}`));
  await test('DELETE public appointment through protected route', async () => request('DELETE', `/api/appointments/${state.publicAppointment.id}`));
  await test('POST /api/customers/:id/anonymize', async () => request('POST', `/api/customers/${state.customer.id}/anonymize`));
  await test('DELETE /api/customers/:id', async () => request('DELETE', `/api/customers/${state.customer.id}`));
  await test('DELETE /api/business-hours/:id', async () => request('DELETE', `/api/business-hours/${state.businessHour.id}`));
  await test('DELETE /api/barbers/:id', async () => request('DELETE', `/api/barbers/${state.barber.id}`));
  await test('DELETE /api/services/:id', async () => request('DELETE', `/api/services/${state.service.id}`));
  await test('DELETE /api/barbershops/:id', async () => request('DELETE', `/api/barbershops/${state.barbershop.id}`));

  const failed = results.filter((result) => !result.ok);
  console.log('\nRoute smoke test summary');
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length) {
    console.log(JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
