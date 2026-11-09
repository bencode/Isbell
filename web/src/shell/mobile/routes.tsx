// A phone's pages. A session lives at the address its push notifications have.

import { Navigate, Route, Routes } from 'react-router'
import { Home } from './home'
import { Later } from './later'
import { PhoneSession } from './session'

export function MobileRoutes() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="s/:mid/*" element={<PhoneSession />} />
      <Route path="new" element={<Later />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
