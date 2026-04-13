"use client";

import { startTransition, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ActivityIcon, KeyRoundIcon, LayoutDashboardIcon, Loader2Icon, LogOutIcon, MessageSquareTextIcon, PlugIcon } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/client";
import { useAppState } from "@/components/app-state-provider";
import { ModeToggle } from "@/components/mode-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";



function LoadingShell() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader className="gap-3">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-4 w-40" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <div className="flex flex-col gap-2 p-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <div className="flex h-svh items-center justify-center">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { authReady, user } = useAppState();

  useEffect(() => {
    if (authReady && !user) {
      router.replace("/auth/sign-in");
    }
  }, [authReady, router, user]);

  async function handleLogout() {
    try {
      await authClient.signOut();
      toast.success("Sessão encerrada.");
      startTransition(() => {
        router.replace("/auth/sign-in");
        router.refresh();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao encerrar sessão.");
    }
  }

  if (!authReady || !user) {
    return <LoadingShell />;
  }

  return (
    <SidebarProvider className="min-h-0 h-svh">
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader className="gap-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <ActivityIcon />
            </div>
            <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-semibold">ModelHub</span>
              <span className="truncate text-xs text-sidebar-foreground/70">{user.email}</span>
            </div>
          </div>
          <Badge variant="secondary" className="w-fit group-data-[collapsible=icon]:hidden">
            Sessão web ativa
          </Badge>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navegação</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/chat"} tooltip="Chat">
                    <Link href="/chat">
                      <MessageSquareTextIcon />
                      <span>Chat</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/setup"} tooltip="Providers">
                    <Link href="/setup">
                      <PlugIcon />
                      <span>Providers</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/dashboard"} tooltip="Dashboard">
                    <Link href="/dashboard">
                      <LayoutDashboardIcon />
                      <span>Dashboard</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter className="gap-3 p-4">
          <div className="grid gap-1 rounded-xl bg-sidebar-accent/70 p-3 text-xs group-data-[collapsible=icon]:hidden">
            <span className="font-medium text-sidebar-accent-foreground">API keys e credenciais</span>
            <span className="text-sidebar-foreground/70">
              Use o dashboard para gerenciar tokens, providers e métricas.
            </span>
          </div>
          <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">
                <KeyRoundIcon data-icon="inline-start" />
                Gerenciar chaves
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOutIcon data-icon="inline-start" />
              Sair
            </Button>
          </div>
          <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Dashboard">
                <Link href="/dashboard">
                  <KeyRoundIcon />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Sair" onClick={handleLogout}>
                <LogOutIcon />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="overflow-hidden">
        <header className="shrink-0 border-b border-border/60 bg-background/90 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {pathname === "/setup" ? "Providers" : pathname === "/dashboard" ? "Dashboard" : "Chat"}
                </span>
                <span className="hidden text-xs text-muted-foreground sm:block">
                  {pathname === "/setup"
                    ? "Configure as chaves dos providers de IA"
                    : pathname === "/dashboard"
                      ? "Conta, uso, API keys e credenciais"
                      : "Converse com os providers configurados"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ModeToggle />
            </div>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
