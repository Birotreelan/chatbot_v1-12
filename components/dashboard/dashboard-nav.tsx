import { Activity } from "react-feather"
import Link from "next/link"

const DashboardNav = () => {
  return (
    <nav>
      <ul>
        <li>
          <Link href="/dashboard/home">
            <a>
              <Activity />
              <span>Home</span>
            </a>
          </Link>
        </li>
        <li>
          <Link href="/dashboard/system-health">
            <a>
              <Activity />
              <span>Monitor de Salud</span>
            </a>
          </Link>
        </li>
        {/* rest of code here */}
      </ul>
    </nav>
  )
}

export default DashboardNav
