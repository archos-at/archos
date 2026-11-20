import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test-utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const height = (primitive: string): string => `max-h-(--radix-${primitive}-content-available-height)`
const width = (primitive: string): string => `max-w-(--radix-${primitive}-content-available-width)`

describe('every floating surface fits the screen it opens on', () => {
  it('a dropdown caps its menu and its submenu to the room it has', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Deep</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    const menus = screen.getAllByRole('menu')
    expect(menus).toHaveLength(2)
    for (const menu of menus) expect(menu).toHaveClass(height('dropdown-menu'), width('dropdown-menu'))
  })

  it('a context menu caps its menu and its submenu to the room it has', () => {
    render(
      <ContextMenu open>
        <ContextMenuTrigger>Canvas</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuSub open>
            <ContextMenuSubTrigger>More</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem>Deep</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>,
    )
    const menus = screen.getAllByRole('menu')
    expect(menus).toHaveLength(2)
    for (const menu of menus) expect(menu).toHaveClass(height('context-menu'), width('context-menu'))
  })

  it('a select caps its list to the room it has', () => {
    render(
      <Select open>
        <SelectTrigger aria-label="Kind">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>,
    )
    expect(screen.getByRole('listbox')).toHaveClass(height('select'), width('select'))
  })

  it('a popover is never wider than the room it has', () => {
    render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Body</PopoverContent>
      </Popover>,
    )
    expect(screen.getByRole('dialog')).toHaveClass(width('popover'))
  })

  it('a tooltip is never wider than the room it has', () => {
    render(
      <Tooltip open>
        <TooltipTrigger>Hint</TooltipTrigger>
        <TooltipContent>Tip</TooltipContent>
      </Tooltip>,
    )
    const content = screen.getAllByText('Tip')[0]?.closest('[data-slot="tooltip-content"]')
    expect(content).toHaveClass(width('tooltip'))
  })
})
