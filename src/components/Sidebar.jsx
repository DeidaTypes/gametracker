import React from 'react'
import { NavLink } from 'react-router-dom'
import { 
  HiOutlineHome, HiHome,
  HiOutlineGlobe, HiGlobe,
  HiOutlineSearch, HiSearch,
  HiOutlineBookOpen, HiBookOpen,
  HiOutlineUser, HiUser
} from 'react-icons/hi'
import './Sidebar.css'

const navItems = [
  { to: '/', label: 'Home', Icon: HiOutlineHome, IconActive: HiHome },
  { to: '/explore', label: 'Explore', Icon: HiOutlineGlobe, IconActive: HiGlobe },
  { to: '/search', label: 'Search', Icon: HiOutlineSearch, IconActive: HiSearch },
  { to: '/library', label: 'Library', Icon: HiOutlineBookOpen, IconActive: HiBookOpen },
  { to: '/profile', label: 'Profile', Icon: HiOutlineUser, IconActive: HiUser },
]

function Sidebar() {
  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <h1>GameTracker</h1>
      </div>
      <nav className="sidebar-nav">
        {navItems.map(({ to, label, Icon, IconActive }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            {({ isActive }) => (
              <>
                <span className="nav-icon">
                  {isActive ? <IconActive /> : <Icon />}
                </span>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default Sidebar
