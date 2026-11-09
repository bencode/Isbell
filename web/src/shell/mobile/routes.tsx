// A phone's pages. A session lives at the address its push notifications have.

import { Navigate, Route, Routes } from 'react-router'
import { Home } from './home'
import { PhoneNewSession } from './new-session'
import { PhoneSession } from './session'

export function MobileRoutes() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="s/:mid/*" element={<PhoneSession />} />
      <Route path="new" element={<PhoneNewSession />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
