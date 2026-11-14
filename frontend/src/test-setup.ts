import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)

// The app's CSRF cookie, as the server would have set it (see csrfHeader in api.ts).
document.cookie = 'XSRF-TOKEN=test-xsrf'
