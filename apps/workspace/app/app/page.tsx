import { redirect } from 'next/navigation'

const AppIndexPage = (): never => {
  redirect('/app/projects')
}

export default AppIndexPage
