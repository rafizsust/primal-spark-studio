import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { Button } from '@/components/ui/button';
import { 
  BookOpen, 
  Home, 
  LogOut, 
  Menu, 
  X,
  FileText,
  ShieldAlert,
  Headphones,
  PenTool,
  Mic,
  Gift
} from 'lucide-react';
import { cn } from '@/lib/utils';

const sidebarItems = [
  { label: 'Dashboard', href: '/admin', icon: Home },
  { label: 'Reading Tests', href: '/admin/reading', icon: BookOpen },
  { label: 'Listening Tests', href: '/admin/listening', icon: Headphones },
  { label: 'Writing Tests', href: '/admin/writing', icon: PenTool },
  { label: 'Speaking Tests', href: '/admin/speaking', icon: Mic },
  { label: 'Promotion Codes', href: '/admin/promotions', icon: Gift },
  { label: 'Test Bank', href: '/admin/testbank', icon: FileText },
  { label: 'Settings', href: '/admin/settings', icon: Menu },
];

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { user, signOut, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdminAccess();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  // Show loading state
  if (authLoading || adminLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Checking access...</p>
        </div>
      </div>
    );
  }

  // Redirect if not logged in
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary">
        <div className="text-center max-w-md p-8 bg-card rounded-lg border">
          <ShieldAlert size={48} className="mx-auto mb-4 text-destructive" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground mb-4">You need to log in to access the admin panel.</p>
          <Button onClick={() => navigate('/auth')}>Go to Login</Button>
        </div>
      </div>
    );
  }

  // Check admin access
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary">
        <div className="text-center max-w-md p-8 bg-card rounded-lg border">
          <ShieldAlert size={48} className="mx-auto mb-4 text-destructive" />
          <h1 className="text-2xl font-bold mb-2">Admin Access Required</h1>
          <p className="text-muted-foreground mb-4">
            You don't have admin privileges. Contact an administrator to get access.
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            Logged in as: {user.email}
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => navigate('/')}>Go Home</Button>
            <Button variant="destructive" onClick={handleLogout}>Logout</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary flex">
      {/* Sidebar */}
      <aside className={cn(
        "bg-card border-r border-border flex flex-col shrink-0",
        sidebarOpen ? "w-64" : "w-16"
      )} style={{ transition: 'width 0.2s ease-in-out' }}>
        {/* Logo */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          {sidebarOpen && (
            <Link to="/admin" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <FileText size={18} className="text-primary-foreground" />
              </div>
              <span className="font-heading font-bold text-lg">Admin</span>
            </Link>
          )}
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </Button>
        </div>

        {/* Back to Site Button - Prominent */}
        <div className="px-2 py-3 border-b border-border">
          <Link to="/">
            <Button variant="outline" size="sm" className={cn(
              "w-full gap-2 bg-primary/10 border-primary/30 hover:bg-primary/20",
              !sidebarOpen && "justify-center px-0"
            )}>
              <Home size={16} className="text-primary shrink-0" />
              {sidebarOpen && <span className="text-primary font-medium">Back to Site</span>}
            </Button>
          </Link>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 p-2 overflow-y-auto">
          {sidebarItems.map((item) => {
            const isActive = location.pathname === item.href || 
              (item.href !== '/admin' && location.pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1",
                  isActive 
                    ? "bg-primary text-primary-foreground" 
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon size={20} className="shrink-0" />
                {sidebarOpen && <span className="font-medium whitespace-nowrap">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-border">
          {sidebarOpen ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
              <Button variant="outline" size="sm" className="w-full" onClick={handleLogout}>
                <LogOut size={16} className="mr-2" />
                Logout
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Button variant="ghost" size="icon" onClick={handleLogout} title="Logout">
                <LogOut size={18} />
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto min-w-0">
        <Outlet />
      </main>
    </div>
  );
}